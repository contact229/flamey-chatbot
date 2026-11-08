// Vercel serverless function: /api/lead
// Flamey's booking form posts here; this function forwards the enquiry to the
// Wrights scheduler. The scheduler's API key stays on the server (a Vercel
// environment variable) and is never sent to the customer's browser.
//
// Required Vercel environment variables:
//   FLAMEY_API_KEY  - the same value as FLAMEY_API_KEY in the scheduler's env-vars.yaml
//   SCHEDULER_URL   - https://wrights-scheduler-517643339879.europe-west2.run.app

const FIELDS = {
  customerName: 120,
  addressLine1: 200,
  city: 100,
  postcode: 12,
  phone: 30,
  email: 200,
  requestedJobTypeText: 200,
  notes: 2000,
};

const JOB_TYPES = ['Boiler Service', 'Boiler Repair', 'Gas Safety Certificate', 'Landlord Certificate', 'General Callout'];

function clean(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.FLAMEY_API_KEY;
  const schedulerUrl = process.env.SCHEDULER_URL;
  if (!apiKey || !schedulerUrl) {
    console.error('FLAMEY_API_KEY or SCHEDULER_URL is not set in Vercel');
    return res.status(500).json({ error: 'Booking is not available right now' });
  }

  const body = req.body || {};
  const lead = {};
  for (const [field, maxLength] of Object.entries(FIELDS)) {
    const value = clean(body[field], maxLength);
    if (value !== undefined) lead[field] = value;
  }

  if (!lead.customerName) {
    return res.status(400).json({ error: 'Please enter your name' });
  }
  if (!lead.phone && !lead.email) {
    return res.status(400).json({ error: 'Please enter a phone number or email' });
  }

  // The job type picked on the form, and a slot the customer agreed to in the
  // chat. The scheduler re-checks the slot itself before holding it.
  if (JOB_TYPES.includes(body.jobTypeName)) lead.jobTypeName = body.jobTypeName;
  const slot = body.agreedSlot;
  if (slot && typeof slot === 'object' && JOB_TYPES.includes(slot.jobTypeName) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(slot.date)) && /^\d{2}:\d{2}$/.test(String(slot.startTime))) {
    lead.agreedSlot = { jobTypeName: slot.jobTypeName, date: slot.date, startTime: slot.startTime };
  }

  try {
    const response = await fetch(`${schedulerUrl}/chatbot/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(lead),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Scheduler rejected lead', response.status, detail);
      return res.status(502).json({ error: 'Booking could not be sent' });
    }

    const data = await response.json().catch(() => ({}));
    return res.status(200).json({ ok: true, slotStatus: data.slotStatus || 'none' });
  } catch (err) {
    console.error('Could not reach scheduler', err);
    return res.status(502).json({ error: 'Booking could not be sent' });
  }
}
