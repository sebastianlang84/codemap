// Stable machine code for the approval gate. Outcome detection (telemetry) keys on `code`, never on the
// English message — commit 7f6866c made that message self-explanatory for humans and it must stay free to
// change without silently breaking any consumer that classifies the failure.
export const NOT_APPROVED_CODE = "not_approved";
// Verbatim human-readable copy for the search/context gate. Kept as a constant so the three throw sites
// stay identical; the CLI relies on this exact wording (tests match /Repository is not approved/).
export const NOT_APPROVED_MESSAGE = "Repository is not approved/indexed yet. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).";
export class NotApprovedError extends Error {
    code = NOT_APPROVED_CODE;
    constructor(message = NOT_APPROVED_MESSAGE) {
        super(message);
        this.name = "NotApprovedError";
    }
}
export function isNotApprovedError(error) {
    return typeof error === "object" && error !== null && error.code === NOT_APPROVED_CODE;
}
