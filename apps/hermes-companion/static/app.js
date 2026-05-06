const token = sessionStorage.getItem("hermes_demo_token") || "dev-user-token";
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
const device = document.querySelector("#device");
const form = document.querySelector("#task-form");
const status = document.querySelector("#status");
const events = document.querySelector("#events");
const taskId = document.querySelector("#task-id");
const cancel = document.querySelector("#cancel");
let currentTask = null;
let eventSource = null;

loadDevices();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  events.innerHTML = "";
  status.textContent = "Starting";
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers,
    body: JSON.stringify({
      device_id: device.value,
      channel: "hermes.task.create",
      body: {
        instruction: document.querySelector("#instruction").value,
        workspace_hint: document.querySelector("#workspace").value,
        stream: true,
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    append("task.error", payload);
    status.textContent = "Failed";
    return;
  }
  currentTask = payload.task_session_id;
  taskId.textContent = currentTask;
  cancel.disabled = false;
  connectEvents(currentTask);
});

cancel.addEventListener("click", async () => {
  if (!currentTask) return;
  await fetch(`/api/tasks/${currentTask}/cancel`, { method: "POST", headers });
});

async function loadDevices() {
  const response = await fetch("/api/devices", { headers });
  const payload = await response.json();
  device.innerHTML = (payload.devices || []).map((item) => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.status)})</option>`
  )).join("");
  status.textContent = payload.devices?.length ? "Ready" : "No devices";
}

function connectEvents(id) {
  eventSource?.close();
  eventSource = new EventSource(`/api/tasks/${id}/events?token=${encodeURIComponent(token)}`);
  for (const name of ["task.status", "task.progress", "task.result", "task.error"]) {
    eventSource.addEventListener(name, (event) => {
      const data = JSON.parse(event.data);
      append(name, data);
      if (name === "task.status") status.textContent = data.status;
      if (data.status === "completed" || data.status === "cancelled" || name === "task.error") {
        cancel.disabled = true;
      }
    });
  }
}

function append(type, data) {
  const row = document.createElement("div");
  row.className = `event ${type.replace(".", "-")}`;
  row.innerHTML = `<strong>${escapeHtml(type)}</strong><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  events.append(row);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
