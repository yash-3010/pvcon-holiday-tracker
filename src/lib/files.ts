/** An uploaded image shown inline, e.g. an employee photo; `/api/files` checks who may see it. */
export const inlineFileUrl = (fileId: number) => `/api/files/${fileId}?inline=1`;
