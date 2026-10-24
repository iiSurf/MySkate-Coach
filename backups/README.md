# Put your MySkate backup here

MySkate Coach only looks in this folder (it never looks in Downloads, iCloud Drive, or anywhere outside the workspace).

In MySkate: Profile, then Save a backup. Move the file (`myskate-backup-YYYY-MM-DD.json`) into this folder, then run `npm run coach`. The newest backup here is used.

Backups are never committed: `.gitignore` leaves out every `myskate-backup-*.json`.
