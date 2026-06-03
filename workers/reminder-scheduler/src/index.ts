const EVENING_CRON = "0 12 * * *";
const MORNING_CRON = "0 0 * * *";
const DEFAULT_BASE_URL = "https://care-wedo.pages.dev";

type Env = {
  CRON_SECRET?: string;
  CRON_BASE_URL?: string;
};

type ReminderTask = {
  endpoint: string;
  label: string;
};

const TASKS: Record<string, ReminderTask> = {
  [EVENING_CRON]: {
    endpoint: "/api/cron/evening",
    label: "evening_next_day_schedule",
  },
  [MORNING_CRON]: {
    endpoint: "/api/cron/reminders",
    label: "morning_same_day_schedule",
  },
};

async function triggerReminder(env: Env, cron: string) {
  const task = TASKS[cron];
  if (!task) {
    console.log(JSON.stringify({ event: "reminder_scheduler.skipped", cron }));
    return;
  }

  if (!env.CRON_SECRET) {
    throw new Error("CRON_SECRET is not configured for reminder scheduler.");
  }

  const baseUrl = (env.CRON_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${task.endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Reminder scheduler ${task.label} failed with ${response.status}: ${responseText.slice(0, 500)}`);
  }

  console.log(JSON.stringify({
    event: "reminder_scheduler.completed",
    cron,
    endpoint: task.endpoint,
    label: task.label,
    status: response.status,
    response: responseText.slice(0, 500),
  }));
}

export default {
  async fetch() {
    return Response.json({
      service: "care-wedo-reminder-scheduler",
      schedules: {
        evening: EVENING_CRON,
        morning: MORNING_CRON,
      },
    });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(triggerReminder(env, controller.cron));
  },
};
