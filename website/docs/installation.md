---
sidebar_position: 3
---

# Installation

## Install the SAS Extension for Positron

The SAS Extension for Positron is published on [Open VSX](https://open-vsx.org/extension/posit/positron-sas), the extension gallery that Positron uses.

1. In Positron, open the Extensions view by clicking the Extensions icon in the Activity Bar.

2. Search for `Positron SAS`, and select **Positron SAS** by Posit.

3. Click **Install**. When the installation is complete, reload the window if Positron asks you to.

Positron updates the extension when a new release is published.

### Install from a VSIX file

Each release is also published as a VSIX file in the [Releases](https://github.com/posit-dev/positron-sas-extension/releases) of the [posit-dev/positron-sas-extension](https://github.com/posit-dev/positron-sas-extension) repository. Use it to install a specific version, or where Positron can't reach Open VSX.

1. Open the [latest release](https://github.com/posit-dev/positron-sas-extension/releases/latest) and download the VSIX file from **Assets**. The file is named `positron-sas-<version>.vsix`, for example `positron-sas-1.1.0.vsix`.

2. In Positron, open the Extensions view by clicking the Extensions icon in the Activity Bar.

3. Click the **...** (Views and More Actions) menu at the top of the Extensions view, and choose **Install from VSIX...**. You can also open the command palette (`F1`, or `Ctrl+Shift+P` on Windows or Linux, or `Shift+CMD+P` on macOS) and run **Extensions: Install from VSIX...**.

4. Select the downloaded file. When the installation is complete, reload the window if Positron asks you to.

To update the extension, install the VSIX file of the newer release in the same way.

After the installation, create a connection profile as described in [Configuring the SAS Extension](./Configurations/index.md). If SAS is installed on the same machine, the extension adds a `local` profile for it automatically. See [Local SAS](./Features/positron.md#local-sas).

### In Posit Workbench

In a Positron Pro session in Posit Workbench, you install the extension the same way. The extension is installed in your home directory, so it stays available in your later sessions, and the installation can take a few minutes. Your administrator may have pointed Positron at a different extension gallery. If the extension isn't found there, or if sessions have no internet access, download the VSIX file on another machine and upload it to your home directory in the session, then choose **Install from VSIX...** and select it.

For the ways to run SAS in Workbench, see [SAS with Posit Workbench](./Workbench/index.md).

### Install a development build

The repository builds the extension after every change that reaches the main branch, and publishes each build as a pre-release. Use a development build to try a change before the next release. A development build can contain unfinished changes.

1. Open the [Releases](https://github.com/posit-dev/positron-sas-extension/releases) page and find the newest entry marked **Pre-release**. Its name is `Positron SAS <version>-dev.<number>`, where `<version>` is the last release.

2. Download the VSIX file from **Assets**, and install it as described in [Install from a VSIX file](#install-from-a-vsix-file).

The notes of a pre-release list the unreleased changes and the commits since the last release. The VSIX file keeps the version number of the last release, so Positron shows the same version for a development build and for the release before it. To return to a released version, install the VSIX file of the latest release. The repository keeps the five newest development builds.

## Install the SAS Extension for Visual Studio Code

The SAS Extension for Positron builds on the SAS Extension for Visual Studio Code, whose documentation is in the other sections of this site. To use SAS's own extension in Visual Studio Code, install the latest version of Visual Studio Code (version 1.89 or later), and then:

1. Open the Extensions view by clicking the Extensions icon in the Activity Bar on the left side of the Visual Studio Code window.

2. Search for the 'Official' SAS extension, and click the Install button. Once the installation is complete, the Install button changes to the Manage button.

**NOTE:**
For macOS users, some environments may require additional certificate installation steps before connecting successfully to a SAS Viya server.
Please refer to the [FAQ](./faq.md) (see "Why did I get the `Unable to parse decrypted password` error?") for details.
