// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/PropertyProvider.ts (Apache-2.0).
import {
  Disposable,
  EventEmitter,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeView,
  env,
  window,
} from "vscode";

import { PROPERTIES_VIEW_ID } from "./const";
import { Messages, PropertyLabelText } from "./messages";
import {
  ItemAccess,
  PropertyKind,
  PropertyRow,
  buildPropertyRows,
} from "./properties";
import type { RepositoryItem } from "./types";

const ICONS: Record<PropertyKind, string> = {
  string: "symbol-string",
  user: "person",
  date: "calendar",
  number: "symbol-number",
  sync: "sync",
  access: "shield",
};

/** The Properties view: details of the item selected in the repository. */
export class PropertyProvider
  implements TreeDataProvider<PropertyRow>, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    PropertyRow | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly treeView: TreeView<PropertyRow>;
  private rows: PropertyRow[] = [];

  constructor() {
    this.treeView = window.createTreeView(PROPERTIES_VIEW_ID, {
      treeDataProvider: this,
    });
    this.clear();
  }

  /**
   * Show an item's properties. `typeName` is its readable object type;
   * `access` the user's permissions, once they are known.
   */
  show(
    item: RepositoryItem,
    typeName: string | undefined,
    access?: ItemAccess,
  ): void {
    this.rows = buildPropertyRows(
      item,
      typeName,
      PropertyLabelText,
      env.language,
      access,
    );
    this.treeView.description = item.name;
    this.treeView.message = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.rows = [];
    this.treeView.description = undefined;
    this.treeView.message = Messages.NoItemSelected;
    this._onDidChangeTreeData.fire(undefined);
  }

  showError(message: string): void {
    this.rows = [];
    this.treeView.description = undefined;
    this.treeView.message = message;
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(): PropertyRow[] {
    return this.rows;
  }

  getTreeItem(row: PropertyRow): TreeItem {
    return {
      id: row.key,
      label: row.label,
      description: row.value,
      tooltip: `${row.label}: ${row.value}`,
      iconPath: new ThemeIcon(ICONS[row.kind]),
    };
  }

  dispose(): void {
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
