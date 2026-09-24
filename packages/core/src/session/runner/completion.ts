export const COMPLETION_MARKER = "[[OPENCODE_TASK_COMPLETE]]"

export const COMPLETION_CONTRACT = `# Completion contract
You must keep working until every requested change, command, build, test, and verification is complete. Never stop with unfinished work.
Do not emit the completion marker in intermediate commentary. When all work is genuinely complete, include the exact marker ${COMPLETION_MARKER} on its own final line.
A final response without the marker is treated as incomplete; OpenCode will automatically continue the task. If blocked, investigate alternatives instead of stopping.`

export const CONTINUE_AFTER_UNCONFIRMED_COMPLETION = `Your previous final response omitted ${COMPLETION_MARKER}. The task is not considered complete. Continue unfinished work, inspect and verify results, and include ${COMPLETION_MARKER} on its own final line only when everything requested is done.`
