# Import Template Contract (v1)

Files are UTF-8 CSV with one header row, comma delimiter, ISO-8601 dates, `true`/`false` booleans, decimal numbers without currency symbols, and stable external IDs. Blank means unknown only where the column is marked optional; it never means delete.

Validate before import: exact header/version, required values, enum membership, unique IDs/emails/SKUs/bin codes, referenced parent IDs, nonnegative amounts/quantities, and duplicate serialized numbers. Reject the whole batch when headers or version are wrong. Produce an error CSV with row number, field, code and remediation; never silently truncate or coerce.

| Template | Natural key | Required parent validation |
| --- | --- | --- |
| `users-v1.csv` | email | approved role/module pair |
| `warehouse-locations-bins-v1.csv` | location_external_id + bin_code | location before bin |
| `warehouse-products-opening-stock-v1.csv` | sku + location_external_id + bin_code | product/location/bin; serialized rows require serial_number |
| `vendors-v1.csv` | vendor_external_id and contact_email | category/jurisdiction/risk enums |

Every import records source filename, template version, checksum, uploader, start/end time, accepted/rejected counts, and reconciliation sign-off. Example rows are illustrative and must be removed from production loads.
