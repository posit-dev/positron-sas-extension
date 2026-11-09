---
sidebar_position: 10
---

# SAS Clinical Acceleration

SAS Clinical Acceleration stores clinical study files in a controlled repository on a SAS Viya server. The Positron SAS extension adds four views to their own **Clinical Acceleration** sidebar, next to the **SAS** one in the activity bar, so that you can browse the repository, work on files in your own workspace, and check them back in.

The **Clinical Acceleration** icon appears in the activity bar, and the views with it, when the active SAS profile is a SAS Viya profile, you are signed in, and the server runs the Clinical Repository service. The extension finds the service on its own and uses your SAS Viya sign-in, so there is nothing to configure.

## The four views

- **Clinical Repository**: the shared store. Files open read-only.
- **Clinical Workspace**: your own area on the server. Files open for editing, and saving a file saves it to your workspace.
- **Clinical Repository Properties** (collapsed at first): the details of the item you select in the **Clinical Repository** view.
- **Clinical Version History** (collapsed at first): the versions of the file you select in the **Clinical Repository** view.

To refresh the **Clinical Repository** view and detect the service again, click **Refresh** in the title bar of the view.

## Browse the repository

Expand folders in the **Clinical Repository** view and click a file to open it read-only. Studies and organizations appear as top-level items. Administrators manage organizations, so you cannot rename or delete them.

Right-click an item to see the actions you can use. The extension shows an action that changes an item only where you have write permission.

- **New Folder**: create a folder in the selected folder.
- **Rename**: rename a file or folder.
- **Delete**: move the selected items to the recycle bin of the Clinical Repository. You can restore them with the Manage Data Repository application of SAS Clinical Acceleration. You cannot delete studies or organizations.
- **Upload** and **Upload and Expand**: add files to a folder. **Upload and Expand** unpacks a zip file into the folder.
- **Download**: save the selected items to your computer. A folder or a selection of several items arrives as a zip file.
- **Copy Path**: copy the repository path of the selected items.

An upload asks for an optional comment and an optional version. Leave the version empty to upload without versioning, which works without any special privilege. Enter a version such as `1.0` to create a versioned file. You can also enter `MAJOR` or `MINOR` to raise the version of a file that is already versioned.

## Work in your workspace

Your workspace is a private area on the server. Files in the repository stay unchanged until you check in your changes from the workspace.

### Get files into the workspace

Right-click an item in the **Clinical Repository** view and use one of these actions:

- **Check out to Workspace > With Content**: reserve the file for yourself and copy its content to the workspace.
- **Check out to Workspace > Without Content**: reserve the file without copying its content to the workspace.
- **Copy to Workspace > Copy Latest Version**: copy the current version of a file without reserving it. On a folder, the action is **Copy Folder** and copies the files in it.
- **Copy to Workspace > Copy Folder Structure**: copy the folders, with their subfolders, but not the files.

To copy an older version, right-click it in the **Clinical Version History** view and select **Copy to Workspace**.

A checked-out file has a **CO** badge in both the **Clinical Repository** and **Clinical Workspace** views. The badge is highlighted for your own check-outs and dimmed for check-outs by other users. Point to the badge to see who has the file.

### Edit and organize files

Click a file in the **Clinical Workspace** view to edit it. Save the file as usual to send the changes to your workspace. Right-click a file or folder for these actions:

- **New File** and **New Folder**: create an item in the selected folder. Without a selection, the item goes to the top level of the workspace.
- **Rename**: rename an item. The extension closes the open editors of the item, and reopens a renamed file.
- **Delete**: remove the selected items from your workspace. This does not change the repository.
- **Upload**, **Upload and Expand**, and **Download**: move files between your computer and the workspace.
- **Copy Path**: copy the workspace path of the selected items.

### Check in

When your changes are ready, right-click a file or folder in the **Clinical Workspace** view and select **Check In**. For a folder, the extension checks in every eligible file in it. The extension asks only the questions that apply to your files:

1. For files that are new to the repository, whether to enable versioning, and the first version.
2. For files that you checked out without versioning, the same two questions.
3. For files that are already versioned, whether to raise the **Major** or **Minor** version.
4. An optional comment.

Select **Undo Check out** to give up your changes to a checked-out file. Only the person who checked out a file can check it in or undo the check-out.

## Versions

Select a versioned file in the **Clinical Repository** view and the **Clinical Version History** view lists its versions, newest first. Point to a version to see who created it, when, its size, and its comment.

Click a version to open it read-only. Right-click a version to download it, compare it, or copy it to your workspace.

To turn versioning on or off for a file, right-click it in the **Clinical Repository** view and select **Enable Versioning** or **Disable Versioning**. Changing versioning needs a versioning privilege on the server. The extension stops and tells you when the server reports that you have no such privilege.

The **Clinical Repository Properties** view shows the details of the selected item. For a file, it lists the size, the lock state, the version, the check-out state, and whether the copy of the file in your workspace is in sync with the repository.

## Compare files and versions

You can compare any two files or versions from the repository, your workspace, and the version history.

1. Right-click the first file or version and select **Select for Compare**.
2. Right-click the second one and select **Compare with Selected**.

To compare two items in the same view, select both, right-click one of them, and select **Compare Selected**.

## Run programs and open datasets

Open a `.sas` file from the **Clinical Workspace** or **Clinical Repository** view and run it as you run any SAS program. The program runs in the SAS console session of the active profile. Running a program does not write its results to your workspace. To keep a result file, save it on your computer and upload it.

A `.sas7bdat` or `.xpt` file from the **Clinical Repository** or **Clinical Workspace** view opens in the Data Explorer. The extension copies the file into the WORK library of the SAS session first, so a SAS session must be running. See [Positron SAS Extension Features](./positron.md) for more about the Data Explorer.

## Permissions and errors

The extension reads your permissions from the server and shows only the actions you can use. If it cannot read them, it shows all actions and the server decides.

:::info note

A server can still refuse an action, such as a check-out without write permission or a versioning change without the privilege. This is the server enforcing its rules. The **SAS Clinical Repository** output channel lists the message from the server. Ask a SAS Clinical Acceleration administrator for the missing permission.

:::

## Limitations

- The views use the active SAS Viya profile. Switch profiles to work with another server.
- The views do not detect changes made by other users or other applications. Click **Refresh** to see them.
- You cannot search the repository, restore deleted items, or change permissions. Use SAS Clinical Acceleration for those tasks.
