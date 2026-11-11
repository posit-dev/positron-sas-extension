// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The form of the clinical job editor (client/src/clinical/jobs/
// JobEditorProvider.ts). It edits the job as a JSON object and sends the
// whole text back on every committed change; fields it does not know are
// kept as they are.
import {
  ChangeEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import {
  EditorLabels,
  FromEditor,
  JobFile,
  PARAMETER_TYPES,
  ToEditor,
  absoluteJobPath,
  dateToDefault,
  defaultToDate,
  emptyDefault,
  parseJobText,
  relativeJobPath,
  serializeJobFile,
  validateJobFile,
} from "../clinical/jobs/jobForm";
import type { JobParameter, ResourceLocation } from "../clinical/jobs/types";

import "./ClinicalJobEditor.css";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (message: FromEditor) => vscode.postMessage(message);

// Path picks are answered asynchronously by the extension.
let nextRequest = 0;
const pending = new Map<number, (path: string | undefined) => void>();
function pick(
  mode: "file" | "folder",
  resourceLocation: ResourceLocation,
  startPath?: string,
): Promise<string | undefined> {
  const requestId = ++nextRequest;
  send({ type: "pick", requestId, mode, resourceLocation, startPath });
  return new Promise((resolve) => pending.set(requestId, resolve));
}

interface Context {
  labels: EditorLabels;
  readOnly: boolean;
  location: string;
  resourceLocation: ResourceLocation;
  canBrowse: boolean;
  canSchedule: boolean;
  canPopulate: boolean;
  fileName: string;
}

/** A text input that commits on blur or Enter, so undo is not per keystroke. */
function TextField({
  value,
  onCommit,
  disabled,
  placeholder,
  type = "text",
  title,
  multiline,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  title?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // A new value from outside (undo, an edit in the text editor) replaces the
  // draft; React's pattern for state derived from props.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };
  const props = {
    value: draft,
    disabled,
    placeholder,
    title,
    className,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea rows={2} {...props} />
  ) : (
    <input
      type={type}
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
        } else if (e.key === "Escape") {
          setDraft(value);
        }
      }}
    />
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Up, down and remove buttons of a list row. */
function RowActions({
  index,
  count,
  labels,
  disabled,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  labels: EditorLabels;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <span className="row-actions">
      <button
        className="icon"
        title={labels.moveUp}
        aria-label={labels.moveUp}
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        ↑
      </button>
      <button
        className="icon"
        title={labels.moveDown}
        aria-label={labels.moveDown}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        ↓
      </button>
      <button
        className="icon"
        title={labels.remove}
        aria-label={labels.remove}
        disabled={disabled}
        onClick={() => onRemove(index)}
      >
        ✕
      </button>
    </span>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function Editor({
  ctx,
  job,
  update,
}: {
  ctx: Context;
  job: JobFile;
  update: (change: Partial<JobFile>) => void;
}) {
  const { labels, readOnly, location, resourceLocation, canBrowse } = ctx;
  const programs = job.programs ?? [];
  const parameters = job.parameters ?? [];
  const setup = job.publishSetup ?? { files: [], folders: [] };
  const checkin = job.publishCheckin ?? { locations: [] };
  const problems = validateJobFile(job);
  const problemAt = (kinds: string[], index: number) =>
    problems.some((p) => kinds.includes(p.kind) && p.index === index);

  const setParameter = (index: number, change: Partial<JobParameter>) =>
    update({
      parameters: parameters.map((p, i) =>
        i === index ? { ...p, ...change } : p,
      ),
    });

  const browseRelative = async (
    mode: "file" | "folder",
    current?: string,
  ): Promise<string | undefined> => {
    const start = current ? absoluteJobPath(location, current) : location;
    const path = await pick(
      mode,
      resourceLocation,
      mode === "file" ? start.replace(/\/[^/]*$/, "") || "/" : start,
    );
    return path && relativeJobPath(location, path);
  };

  const versionChoice = (value: string | undefined) =>
    value === "MAJOR" || value === "MINOR" || !value ? (value ?? "") : "custom";

  return (
    <>
      {problems.length > 0 && (
        <ul className="problems" role="alert">
          {[...new Set(problems.map((p) => labels.problems[p.kind]))].map(
            (text) => (
              <li key={text}>{text}</li>
            ),
          )}
        </ul>
      )}

      <Section title={labels.general}>
        <label className="field">
          <span>{labels.description}</span>
          <TextField
            multiline
            value={job.description ?? ""}
            disabled={readOnly}
            onCommit={(description) => update({ description })}
          />
        </label>
      </Section>

      <Section title={labels.programs} hint={labels.programsHint}>
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{labels.path}</th>
              <th className="narrow">{labels.version}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {programs.map((program, index) => (
              <tr
                key={index}
                className={problemAt(["programPath"], index) ? "invalid" : ""}
              >
                <td className="num">{index + 1}</td>
                <td>
                  <TextField
                    value={program.path ?? ""}
                    disabled={readOnly}
                    title={absoluteJobPath(location, program.path ?? "")}
                    onCommit={(path) =>
                      update({
                        programs: programs.map((p, i) =>
                          i === index ? { ...p, path } : p,
                        ),
                      })
                    }
                  />
                </td>
                <td className="narrow">
                  <TextField
                    value={program.version ?? program.fileVersion ?? ""}
                    placeholder={labels.latest}
                    disabled={readOnly}
                    onCommit={(version) =>
                      update({
                        programs: programs.map((p, i) =>
                          i === index ? { ...p, version: version || null } : p,
                        ),
                      })
                    }
                  />
                </td>
                <td className="actions">
                  {canBrowse && (
                    <button
                      className="link"
                      onClick={() =>
                        send({
                          type: "open",
                          path: absoluteJobPath(location, program.path ?? ""),
                        })
                      }
                    >
                      {labels.open}
                    </button>
                  )}
                  <RowActions
                    index={index}
                    count={programs.length}
                    labels={labels}
                    disabled={readOnly}
                    onMove={(from, to) =>
                      update({ programs: move(programs, from, to) })
                    }
                    onRemove={(i) =>
                      update({ programs: programs.filter((_, j) => j !== i) })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && canBrowse && (
          <button
            onClick={async () => {
              const path = await browseRelative("file");
              if (path) {
                update({ programs: [...programs, { path, version: null }] });
              }
            }}
          >
            {labels.addProgram}
          </button>
        )}
        {!readOnly && !canBrowse && (
          <button
            onClick={() =>
              update({ programs: [...programs, { path: "", version: null }] })
            }
          >
            {labels.addProgram}
          </button>
        )}
      </Section>

      <Section title={labels.parameters} hint={labels.parametersHint}>
        {parameters.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{labels.name}</th>
                <th>{labels.label}</th>
                <th className="narrow">{labels.type}</th>
                <th>{labels.defaultValue}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parameters.map((param, index) => (
                <tr
                  key={index}
                  className={
                    problemAt(
                      [
                        "parameterName",
                        "parameterDuplicate",
                        "parameterNumber",
                        "parameterDate",
                      ],
                      index,
                    )
                      ? "invalid"
                      : ""
                  }
                >
                  <td>
                    <TextField
                      value={param.name ?? ""}
                      disabled={readOnly}
                      onCommit={(name) => setParameter(index, { name })}
                    />
                  </td>
                  <td>
                    <TextField
                      value={param.label ?? ""}
                      disabled={readOnly}
                      onCommit={(label) => setParameter(index, { label })}
                    />
                  </td>
                  <td className="narrow">
                    <select
                      value={param.type}
                      disabled={readOnly}
                      onChange={(e) => {
                        const type = PARAMETER_TYPES.find(
                          (t) => t === e.target.value,
                        );
                        if (type) {
                          setParameter(index, {
                            type,
                            defaultValue: emptyDefault(type),
                          });
                        }
                      }}
                    >
                      {PARAMETER_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {labels.types[type]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DefaultEditor
                      param={param}
                      ctx={ctx}
                      browse={browseRelative}
                      onChange={(defaultValue) =>
                        setParameter(index, { defaultValue })
                      }
                    />
                  </td>
                  <td className="actions">
                    <RowActions
                      index={index}
                      count={parameters.length}
                      labels={labels}
                      disabled={readOnly}
                      onMove={(from, to) =>
                        update({ parameters: move(parameters, from, to) })
                      }
                      onRemove={(i) =>
                        update({
                          parameters: parameters.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!readOnly && (
          <button
            onClick={() => {
              let n = parameters.length + 1;
              const names = new Set(
                parameters.map((p) => p.name?.toUpperCase()),
              );
              while (names.has(`PARAM${n}`)) {
                n++;
              }
              update({
                parameters: [
                  ...parameters,
                  {
                    name: `param${n}`,
                    label: "",
                    type: "CHARACTER",
                    defaultValue: "",
                  },
                ],
              });
            }}
          >
            {labels.addParameter}
          </button>
        )}
      </Section>

      <Section title={labels.outputs} hint={labels.outputsHint}>
        {(
          [
            ["logsLocation", labels.logsLocation],
            ["resultsLocation", labels.resultsLocation],
            ["manifestLocation", labels.manifestLocation],
          ] as const
        ).map(([key, text]) => (
          <div className="field inline" key={key}>
            <span>{text}</span>
            <TextField
              value={job[key] ?? ""}
              placeholder="./"
              disabled={readOnly}
              title={absoluteJobPath(location, job[key] || "./")}
              onCommit={(value) => update({ [key]: value })}
            />
            {!readOnly && canBrowse && (
              <button
                onClick={async () => {
                  const path = await browseRelative("folder", job[key]);
                  if (path) {
                    update({ [key]: path });
                  }
                }}
              >
                {labels.browse}
              </button>
            )}
          </div>
        ))}
      </Section>

      <Section title={labels.repository} hint={labels.repositoryHint}>
        <h3>{labels.inputFiles}</h3>
        <PathList
          ctx={ctx}
          items={setup.files.map((f) => ({ path: f.path }))}
          mode="file"
          onChange={(items) =>
            update({
              publishSetup: {
                ...setup,
                files: items.map((item) => ({
                  ...setup.files.find((f) => f.path === item.path),
                  path: item.path,
                })),
              },
            })
          }
          addLabel={labels.addFile}
        />
        <h3>{labels.inputFolders}</h3>
        <PathList
          ctx={ctx}
          items={setup.folders}
          mode="folder"
          flags={[
            ["includeFiles", labels.includeFiles],
            ["includeSubfolders", labels.includeSubfolders],
          ]}
          onChange={(folders) =>
            update({ publishSetup: { ...setup, folders } })
          }
          addLabel={labels.addFolder}
        />
        <h3>{labels.checkin}</h3>
        <div className="field inline">
          <span>{labels.checkinVersion}</span>
          <select
            value={versionChoice(checkin.fileVersion)}
            disabled={readOnly}
            onChange={(e) =>
              update({
                publishCheckin: {
                  ...checkin,
                  fileVersion:
                    e.target.value === "custom" ? "1.0" : e.target.value,
                },
              })
            }
          >
            <option value="">{labels.versionNone}</option>
            <option value="MAJOR">{labels.versionMajor}</option>
            <option value="MINOR">{labels.versionMinor}</option>
            <option value="custom">{labels.version}…</option>
          </select>
          {versionChoice(checkin.fileVersion) === "custom" && (
            <TextField
              className="narrow"
              value={checkin.fileVersion ?? ""}
              disabled={readOnly}
              onCommit={(fileVersion) =>
                update({ publishCheckin: { ...checkin, fileVersion } })
              }
            />
          )}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!checkin.enableVersioningOnNewFiles}
            disabled={readOnly}
            onChange={(e) =>
              update({
                publishCheckin: {
                  ...checkin,
                  enableVersioningOnNewFiles: e.target.checked,
                },
              })
            }
          />
          {labels.versionNewFiles}
        </label>
        <h3>{labels.checkinLocations}</h3>
        <PathList
          ctx={ctx}
          items={checkin.locations}
          mode="folder"
          flags={[["includeSubfolders", labels.includeSubfolders]]}
          onChange={(locations) =>
            update({ publishCheckin: { ...checkin, locations } })
          }
          addLabel={labels.addFolder}
        />
      </Section>
    </>
  );
}

/** The default value input of a parameter, by type. */
function DefaultEditor({
  param,
  ctx,
  browse,
  onChange,
}: {
  param: JobParameter;
  ctx: Context;
  browse: (
    mode: "file" | "folder",
    current?: string,
  ) => Promise<string | undefined>;
  onChange: (value: JobParameter["defaultValue"]) => void;
}) {
  const { readOnly, labels, canBrowse } = ctx;
  const value = param.defaultValue;
  const text = typeof value === "string" ? value : "";
  switch (param.type) {
    case "DATE":
      return (
        <TextField
          type="date"
          value={defaultToDate(value)}
          disabled={readOnly}
          onCommit={(date) => onChange(dateToDefault(date))}
        />
      );
    case "CHARACTER_MASKED":
      return (
        <TextField
          type="password"
          value={text}
          disabled={readOnly}
          onCommit={onChange}
        />
      );
    case "FILE":
    case "FOLDER": {
      const path =
        value && typeof value === "object" && "path" in value ? value.path : "";
      const subfolders =
        value && typeof value === "object" && "includeSubfolders" in value
          ? value.includeSubfolders
          : false;
      const set = (newPath: string, include = subfolders) =>
        onChange(
          param.type === "FOLDER"
            ? { path: newPath, includeSubfolders: include }
            : { path: newPath },
        );
      return (
        <div className="path-default">
          <TextField
            value={path}
            disabled={readOnly}
            onCommit={(p) => set(p)}
          />
          {!readOnly && canBrowse && (
            <button
              onClick={async () => {
                const picked = await browse(
                  param.type === "FILE" ? "file" : "folder",
                  path || undefined,
                );
                if (picked) {
                  set(picked);
                }
              }}
            >
              {labels.browse}
            </button>
          )}
          {param.type === "FOLDER" && (
            <label className="check">
              <input
                type="checkbox"
                checked={subfolders}
                disabled={readOnly}
                onChange={(e) => set(path, e.target.checked)}
              />
              {labels.includeSubfolders}
            </label>
          )}
        </div>
      );
    }
    default:
      return <TextField value={text} disabled={readOnly} onCommit={onChange} />;
  }
}

interface PathItem {
  path: string;
  includeFiles?: boolean;
  includeSubfolders?: boolean;
}
type Flag = "includeFiles" | "includeSubfolders";

/** A list of repository paths with optional flags, for repository runs. */
function PathList({
  ctx,
  items,
  mode,
  flags = [],
  onChange,
  addLabel,
}: {
  ctx: Context;
  items: PathItem[];
  mode: "file" | "folder";
  flags?: [Flag, string][];
  onChange: (items: PathItem[]) => void;
  addLabel: string;
}) {
  const { readOnly, labels, canBrowse } = ctx;
  return (
    <>
      {items.length ? (
        <table>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td>
                  <TextField
                    value={item.path}
                    disabled={readOnly}
                    onCommit={(path) =>
                      onChange(
                        items.map((it, i) =>
                          i === index ? { ...it, path } : it,
                        ),
                      )
                    }
                  />
                </td>
                {flags.map(([key, text]) => (
                  <td key={key} className="flag">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!item[key]}
                        disabled={readOnly}
                        onChange={(e) =>
                          onChange(
                            items.map((it, i) =>
                              i === index
                                ? { ...it, [key]: e.target.checked }
                                : it,
                            ),
                          )
                        }
                      />
                      {text}
                    </label>
                  </td>
                ))}
                <td className="actions">
                  <RowActions
                    index={index}
                    count={items.length}
                    labels={labels}
                    disabled={readOnly}
                    onMove={(from, to) => onChange(move(items, from, to))}
                    onRemove={(i) => onChange(items.filter((_, j) => j !== i))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">{labels.none}</p>
      )}
      {!readOnly && canBrowse && (
        <button
          onClick={async () => {
            // Repository runs read and write repository paths.
            const path = await pick(mode, "REPOSITORY");
            if (path) {
              const item: PathItem = { path };
              for (const [key] of flags) {
                item[key] = key === "includeFiles";
              }
              onChange([...items, item]);
            }
          }}
        >
          {addLabel}
        </button>
      )}
    </>
  );
}

function App() {
  const [ctx, setCtx] = useState<Context>();
  const [job, setJob] = useState<JobFile>();
  const [error, setError] = useState<string>();
  const jobRef = useRef<JobFile | undefined>(undefined);

  const show = useCallback((text: string) => {
    const result = parseJobText(text);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(undefined);
    jobRef.current = result.job;
    setJob(result.job);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent<ToEditor>) => {
      const message = event.data;
      switch (message.type) {
        case "init":
          setCtx({
            labels: message.labels,
            readOnly: message.readOnly,
            location: message.location,
            resourceLocation: message.resourceLocation,
            canBrowse: message.canBrowse,
            canSchedule: message.canSchedule,
            canPopulate: message.canPopulate,
            fileName: message.fileName,
          });
          show(message.text);
          break;
        case "text":
          show(message.text);
          break;
        case "picked":
          pending.get(message.requestId)?.(message.path);
          pending.delete(message.requestId);
          break;
      }
    };
    window.addEventListener("message", listener);
    send({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, [show]);

  const update = useCallback((change: Partial<JobFile>) => {
    const next = { ...(jobRef.current ?? {}), ...change };
    jobRef.current = next;
    setJob(next);
    send({ type: "edit", text: serializeJobFile(next) });
  }, []);

  if (!ctx) {
    return null;
  }
  return (
    <main>
      <header>
        <h1>{ctx.fileName}</h1>
        <span className="toolbar">
          <button className="primary" onClick={() => send({ type: "run" })}>
            ▶ {ctx.labels.run}
          </button>
          {ctx.canPopulate && (
            <button onClick={() => send({ type: "runAndPopulate" })}>
              {ctx.labels.runAndPopulate}
            </button>
          )}
          {ctx.canSchedule && (
            <button onClick={() => send({ type: "schedule" })}>
              {ctx.labels.schedule}
            </button>
          )}
          <button onClick={() => send({ type: "openText" })}>
            {ctx.labels.openAsJson}
          </button>
        </span>
      </header>
      {ctx.readOnly && <p className="banner">{ctx.labels.readOnly}</p>}
      {error ? (
        <p className="banner error">
          {ctx.labels.invalidJson} ({error})
        </p>
      ) : (
        job && <Editor ctx={ctx} job={job} update={update} />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
