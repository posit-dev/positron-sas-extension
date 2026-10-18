// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, EventEmitter } from "vscode";

import type {
  DataConnection,
  DataConnectionDriver,
  DataConnectionNode,
  DataConnectionNodeDetails,
  DataConnectionNodeDetailsSection,
  DataConnectionParameterValues,
  DiscoveredDataConnection,
  PositronApi,
} from "./positron-types";
import type { ColumnInfo, SasClient } from "./sasClient";
import {
  type ServerFilesBrowser,
  guessLanguage,
} from "./sasServerFilesConnection";

export const SAS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#0066CC"/>
  <text x="50" y="60" font-family="Arial" font-size="40" fill="white" text-anchor="middle" font-weight="bold">S</text>
</svg>`;

const MECHANISM_ID = "session";
const CONTENT_LIBRARIES = "libraries";
const CONTENT_FILES = "files";

// Files shown inline in the details editor; larger or binary ones are not.
const MAX_INLINE_FILE_BYTES = 512 * 1024;
const BINARY_EXTENSIONS = new Set([
  "sas7bdat",
  "sas7bcat",
  "sas7bvew",
  "sas7bndx",
  "sas7bitm",
  "xlsx",
  "xls",
  "zip",
  "gz",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "pdf",
]);

/** A running SAS session whose libraries can be browsed. */
export interface SasDataConnectionSource {
  profileName: string;
  host: string;
  client: Pick<
    SasClient,
    "getLibraryList" | "getLibraryMembers" | "getDatasetColumns"
  >;
  openDataExplorer(lib: string, mem: string): void;
  /** Compute file system of the session (REST/Viya profiles only). */
  serverFiles?: Pick<
    ServerFilesBrowser,
    "listDirectory" | "readFile" | "getProperties"
  >;
}

/**
 * Whether to use the Data Connections pane (Positron 2026.10+). When it is
 * enabled, Positron disposes `positron.connection` comms opened by sessions,
 * so the legacy Connections pane path cannot be used.
 */
export function isDataConnectionsPaneActive(
  api: PositronApi,
  settingEnabled: boolean | undefined,
): boolean {
  return (
    typeof api.dataConnections?.registerDriver === "function" &&
    settingEnabled === true
  );
}

const formatType = (column: ColumnInfo) =>
  column.type === "char" && column.length
    ? `char(${column.length})`
    : column.type;

/**
 * Data Connections driver exposing the libraries of running SAS sessions.
 * Each session registers itself as a source and shows up as a discovered
 * connection, keyed by profile name.
 */
export class SasDataConnectionsDriver
  implements DataConnectionDriver, Disposable
{
  readonly id = "posit-sas";
  readonly name = "SAS";
  readonly description =
    "Browse the libraries and server files of a running SAS session";
  readonly iconSvg = SAS_ICON_SVG;
  readonly supportedLanguageIds: string[] = [];
  readonly mechanisms = [
    {
      id: MECHANISM_ID,
      label: "SAS Session",
      description: "Connect to the SAS session started for a profile",
      parameters: [
        {
          id: "profile",
          label: "Profile",
          description: "A SAS console session must be running for this profile",
          type: "string" as const,
          required: true,
        },
        {
          id: "content",
          label: "Content",
          description: "Server files are available for SAS Viya profiles only",
          type: "option" as const,
          options: [CONTENT_LIBRARIES, CONTENT_FILES],
          defaultValue: CONTENT_LIBRARIES,
        },
      ],
    },
  ];

  private readonly sources = new Map<string, SasDataConnectionSource>();
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  /** Register a running session. Dispose the result when the session ends. */
  addSource(source: SasDataConnectionSource): Disposable {
    this.sources.set(source.profileName, source);
    this.changeEmitter.fire();
    return new Disposable(() => {
      if (this.sources.get(source.profileName) === source) {
        this.sources.delete(source.profileName);
        this.changeEmitter.fire();
      }
    });
  }

  async discoverConnections(): Promise<DiscoveredDataConnection[]> {
    return [...this.sources.values()].flatMap((source) => {
      const description = source.host || undefined;
      const connections: DiscoveredDataConnection[] = [
        {
          id: source.profileName,
          name: `SAS (${source.profileName})`,
          description,
          mechanismId: MECHANISM_ID,
          parameters: {
            profile: source.profileName,
            content: CONTENT_LIBRARIES,
          },
        },
      ];
      if (source.serverFiles) {
        connections.push({
          id: `${source.profileName}/files`,
          name: `SAS Server Files (${source.profileName})`,
          description,
          mechanismId: MECHANISM_ID,
          parameters: { profile: source.profileName, content: CONTENT_FILES },
        });
      }
      return connections;
    });
  }

  async connect(
    _mechanismId: string,
    parameters: DataConnectionParameterValues,
  ): Promise<DataConnection> {
    const profileName = String(parameters.profile ?? "");
    // Look the source up on every call so a restarted session is picked up.
    const getSource = () => {
      const source = this.sources.get(profileName);
      if (!source) {
        throw new Error(
          `No running SAS session for profile "${profileName}". Start a SAS console session first.`,
        );
      }
      return source;
    };
    getSource();

    if (parameters.content === CONTENT_FILES) {
      const getFiles = () => {
        const files = getSource().serverFiles;
        if (!files) {
          throw new Error(
            `Server files are not available for profile "${profileName}".`,
          );
        }
        return files;
      };
      getFiles();
      return {
        isReadOnly: async () => true,
        isConnected: async () => !!this.sources.get(profileName)?.serverFiles,
        disconnect: async () => {},
        getChildren: () => this.directoryChildren(getFiles, []),
      };
    }

    return {
      isReadOnly: async () => true,
      isConnected: async () => this.sources.has(profileName),
      disconnect: async () => {},
      getChildren: async () => {
        const libraries = await getSource().client.getLibraryList();
        return libraries.map((lib) => this.libraryNode(getSource, lib));
      },
    };
  }

  private async directoryChildren(
    getFiles: () => NonNullable<SasDataConnectionSource["serverFiles"]>,
    segments: string[],
  ): Promise<DataConnectionNode[]> {
    const entries = await getFiles().listDirectory(segments);
    return entries.map(({ name, isDirectory }) => {
      const path = [...segments, name];
      return isDirectory
        ? {
            name,
            kind: "directory" as const,
            path: `/${path.join("/")}`,
            getChildren: () => this.directoryChildren(getFiles, path),
          }
        : {
            name,
            kind: "file" as const,
            path: `/${path.join("/")}`,
            getDetails: () => this.fileDetails(getFiles, path),
          };
    });
  }

  private async fileDetails(
    getFiles: () => NonNullable<SasDataConnectionSource["serverFiles"]>,
    segments: string[],
  ): Promise<DataConnectionNodeDetails> {
    const files = getFiles();
    const fileName = segments[segments.length - 1];
    const props = await files.getProperties(segments);
    const properties = [{ name: "Path", value: `/${segments.join("/")}` }];
    if (props.size !== undefined) {
      properties.push({ name: "Size", value: `${props.size} bytes` });
    }
    if (props.modified) {
      properties.push({ name: "Modified", value: props.modified });
    }
    const sections: DataConnectionNodeDetailsSection[] = [
      { kind: "properties", properties },
    ];

    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (BINARY_EXTENSIONS.has(ext)) {
      return { description: "Binary file; content not shown", sections };
    }
    if (props.size !== undefined && props.size > MAX_INLINE_FILE_BYTES) {
      return { description: "File too large to show inline", sections };
    }
    sections.push({
      kind: "code",
      title: "Content",
      languageId: guessLanguage(fileName),
      code: await files.readFile(segments),
    });
    return { sections };
  }

  private libraryNode(
    getSource: () => SasDataConnectionSource,
    lib: string,
  ): DataConnectionNode {
    return {
      name: lib,
      kind: "schema",
      path: lib,
      getChildren: async () => {
        const members = await getSource().client.getLibraryMembers(lib);
        return members.map(({ name, type }) =>
          this.memberNode(getSource, lib, name, type === "VIEW"),
        );
      },
    };
  }

  private memberNode(
    getSource: () => SasDataConnectionSource,
    lib: string,
    mem: string,
    isView: boolean,
  ): DataConnectionNode {
    return {
      name: mem,
      kind: isView ? "view" : "table",
      path: `${lib}.${mem}`,
      getChildren: async () => {
        const columns = await getSource().client.getDatasetColumns(lib, mem);
        return columns.map((column) => ({
          name: column.name,
          kind: "field" as const,
          dataType: formatType(column),
        }));
      },
      preview: async () => {
        getSource().openDataExplorer(lib, mem);
      },
    };
  }

  dispose(): void {
    this.sources.clear();
    this.changeEmitter.dispose();
  }
}
