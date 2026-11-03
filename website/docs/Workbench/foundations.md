---
sidebar_position: 5
---

# Across All Scenarios

These topics apply to every scenario. The examples come from a reference deployment, which runs Posit Workbench, Posit Connect, and SAS Viya in one Amazon EKS cluster.

## Identity and Files

SAS and Posit work best when a person has the same identity on both.

- **Single sign-on:** Workbench and Connect sign users in through the same identity provider as SAS Viya. In the reference deployment, both use Security Assertion Markup Language (SAML) clients in the SAS Viya Keycloak realm.
- **The same user account:** a shared LDAP directory gives each user the same user name, user ID, and group ID in Workbench sessions and in SAS Viya compute. The directory is federated into Keycloak and read by Workbench through SSSD.
- **Shared home directories:** Workbench and SAS Viya compute mount the same `/home` file system. Files created in a Workbench session are available to SAS Viya code under the same path and owner, and the other way around.

With these in place, users sign in once in the browser, and files move between SAS and R or Python without copying.

## Posit Assistant with SAS

Posit Assistant in Positron works with SAS through the SAS extension: it lists libraries and tables, reads SAS output and graphs, and can create a saspy configuration. See [Positron SAS Extension Features](../Features/positron.md#posit-assistant).

The Assistant needs access to a language model. In the reference deployment, Workbench sessions use Amazon Bedrock through AWS Identity and Access Management (IAM) roles for service accounts. Sessions that start as root for SAS (the unmodified SAS Analytics Pro container) must set root on the container, not the pod, or the session cannot read the IAM role's token. See [Local SAS: SAS Analytics Pro Container](./Positron/localContainer.md).

## Governance and Traceability

The extension records who ran which SAS code:

- An optional audit log in JSON Lines format for every submission
- A comment with the user and session on every submitted program
- Macro variables with the Positron and Workbench session, for use in SAS code and logs
- Tags on SAS Viya compute sessions and jobs with the Workbench user and session

See [Traceability](../Features/positron.md#traceability) for the settings.

## SAS Data Files

Positron opens SAS data sets (`.sas7bdat`) and transport files (`.xpt`) in the Data Explorer through the active SAS session. For a file in the session, the SAS session assigns a library to the file's folder, so the SAS session must be able to read that folder. That is always the case with local SAS, and with remote SAS when it shares the file system with Workbench, as SAS Viya does in the reference deployment. Files from the Clinical Repository or SAS Content are copied into WORK first. R and Python code can read the same files with packages such as haven and pyreadstat.
