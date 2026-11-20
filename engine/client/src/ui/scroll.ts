/** Is the reader at (or near) the end of a scroll area? Then new messages may follow them down; otherwise they are reading older ones and are left where they are. */
export const NEAR_END = 150;
export const nearEnd = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = NEAR_END) => el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
