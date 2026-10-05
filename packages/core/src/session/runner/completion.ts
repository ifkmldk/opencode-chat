export const COMPLETION_MARKER = "[[OPENCODE_TASK_COMPLETE]]"

export const COMPLETION_CONTRACT = `# Completion contract
When you were asked to do work (change files, run commands, build, test, search and verify), keep going until every requested part is done and checked; do not stop with unfinished work.
A plain question or request for an explanation needs no extra work: answer it directly and stop.
When all requested work is genuinely complete, end your final response with the exact marker ${COMPLETION_MARKER} on its own line. Do not emit the marker in intermediate commentary. If you are blocked, try alternatives before stopping.`

export const CONTINUE_AFTER_UNCONFIRMED_COMPLETION = `Your previous final response did not end with ${COMPLETION_MARKER}. If everything the user asked for is done, reply with only ${COMPLETION_MARKER} on its own line: do not repeat your answer and do not start new work. If something requested is still unfinished, finish exactly that, then end with the marker.`
