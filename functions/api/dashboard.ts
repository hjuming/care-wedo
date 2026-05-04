import {
  AppointmentRow,
  MedicationRow,
  serializeAppointment,
  serializeMedication,
  supabaseFetch,
} from "../_shared/supabase";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const appointments = await supabaseFetch<AppointmentRow[]>(
      env,
      "appointments?status=eq.upcoming&select=*&order=date.asc.nullslast,created_at.desc",
    );
    const medications = await supabaseFetch<MedicationRow[]>(
      env,
      "medications?active=eq.true&select=*&order=created_at.desc",
    );

    const checklist = appointments.slice(0, 3).map((apt) => {
      const label = `${apt.date || ""} ${apt.department || apt.hospital || "回診"}`.trim();
      if (apt.fasting_required) return `${label}：需空腹 ${apt.fasting_hours || 8} 小時`;
      return label;
    });

    return Response.json({
      patient: {
        name: "家人",
        age: "",
        dept: appointments[0]?.department || "醫療照護",
        diagnoses: [],
      },
      appointments: appointments.map(serializeAppointment),
      medications: medications.map(serializeMedication),
      checklist,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dashboard API failed" },
      { status: 500 },
    );
  }
};
