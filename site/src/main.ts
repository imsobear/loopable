import { startFlow } from "./flow.ts";

const flow = document.getElementById("flow");
if (flow) startFlow(flow);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

const copy = document.getElementById("copy-install");
const install = document.getElementById("install");
copy?.addEventListener("click", async () => {
  const text = install?.textContent?.trim() ?? "";
  const ok = await copyText(text);
  copy.textContent = ok ? "Copied" : "Copy";
  if (ok) {
    window.setTimeout(() => {
      copy.textContent = "Copy";
    }, 1400);
  }
});
