# Private Google Sheets source

The app reads the Posts tab of LinkedIn Post Summaries on the server. Visitors receive only rows explicitly marked Published. Ready and Review rows are withheld. Source locations, hashes, review notes, and capture metadata are not returned. Full summary Markdown is public when its row is Published, so review that entire field before publication.

## Required configuration

1. Create a dedicated Google Cloud project or use an appropriate existing project. Enable the Google Sheets API.
2. Create a dedicated service account with no project IAM roles and no domain-wide delegation.
3. Share only this spreadsheet with the account email as Viewer. Keep general access Restricted.
4. Configure server-only Vercel environment variables:
   - GOOGLE_SHEETS_SPREADSHEET_ID: 1k-yWaFYLCOyAIALFJswDlqfF-cgonkWxfOxn5l42bJ4
   - GOOGLE_SERVICE_ACCOUNT_EMAIL: dedicated account email
   - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: account private key, with real newlines or escaped newline sequences
5. Redeploy the repair branch as a preview. Initially the collection is empty because the workbook contains Ready/Review rows. Publish selected rows only after approval.
6. Verify the preview, then promote the tested deployment to production.

Never place credentials in NEXT_PUBLIC variables, GitHub, spreadsheet cells, browser code, or chat messages. Google authentication requests only spreadsheets.readonly. The service account's file sharing restricts which spreadsheet it can read. The endpoint is fixed to the configured spreadsheet and Posts range; visitors cannot request other files or ranges.

Successful feed responses are cached for up to 60 seconds. Unpublishing may take that long to affect new requests. Previously downloaded public content cannot be recalled. API failures show an unavailable message rather than falling back to old CSV data.

Week-only entries display their ISO week. Limited day filters omit them; All time is the default. The full-summary dialog renders Markdown as literal text, without executing embedded HTML. Search includes full summary text.

## Validation

Run `node --test tests/sheetRecords.test.cjs` and `npm run build`. A live integration check remains necessary once credentials and Viewer sharing exist. Read-only Google access does not allow the app to modify the workbook.
