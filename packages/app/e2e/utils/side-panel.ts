import type { Locator } from "@playwright/test"

// fork: the side panel "+" is always a menu (Open file, Browser, Terminal, Side chat, Canvas, Research),
// so opening the file browser takes two clicks instead of upstream's one-click "Open file" button.
export function addTabButton(panel: Locator) {
  return panel.getByRole("button", { name: "Add tab", exact: true })
}

export async function openFileBrowser(panel: Locator) {
  await addTabButton(panel).click()
  await panel.page().getByRole("menuitem", { name: /^Open file/ }).click()
}
