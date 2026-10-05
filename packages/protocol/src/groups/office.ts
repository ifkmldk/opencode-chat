import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"

// fork: exact previews of Word, PowerPoint and Excel files. The server converts the file to PDF with the Office or
// LibreOffice installed on the host, and the web UI draws that PDF, so the preview matches what Office shows.
export const OfficePreview = Schema.Struct({
  engine: Schema.String,
  pdf: Schema.String.annotate({ description: "Base64 encoded PDF." }),
}).annotate({ identifier: "OfficePreview" })

export const OfficeGroup = HttpApiGroup.make("server.office")
  .add(
    HttpApiEndpoint.post("office.preview", "/api/experimental/office/preview", {
      payload: Schema.Struct({
        name: Schema.String,
        data: Schema.String.annotate({ description: "Base64 encoded .docx, .pptx or .xlsx file." }),
      }),
      success: OfficePreview,
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "office.preview",
        summary: "Render an Office file to PDF",
        description:
          "Convert a Word, PowerPoint or Excel file to PDF with the Office suite installed on the server host. Returns 503 when no engine is available.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "office",
      description: "Office document preview routes.",
    }),
  )
