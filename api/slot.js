// Vercel serverless function: /api/slot
// Asks the Wrights scheduler for the best day to offer a customer in the chat.
// Read-only on the scheduler's side: nothing is booked or held here.
//
// Uses the same Vercel environment variables as /api/lead:
//   FLAMEY_API_KEY, SCHEDULER_URL

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
  if (!apiKey || !schedulerUrl) return res.status(200).json({ outcome: 'no_offer', reason: 'not_configured' });

  const body = req.body || {};
  const jobTypeName = JOB_TYPES.find(t => t === body.jobTypeName);
  const postcode = clean(body.postcode, 12);
  if (!jobTypeName || !postcode) return res.status(200).json({ outcome: 'no_offer', reason: 'not_bookable' });

  const excludeDates = (Array.isArray(body.excludeDates) ? body.excludeDates : [])
    .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .slice(0, 10);

  try {
    const response = await fetch(`${schedulerUrl}/chatbot/suggest-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        jobTypeName,
        postcode,
        addressLine1: clean(body.addressLine1, 200),
        city: clean(body.city, 100),
        excludeDates,
      }),
    });
    if (!response.ok) {
      console.error('Scheduler slot request failed', response.status, await response.text());
      return res.status(200).json({ outcome: 'no_offer', reason: 'scheduler_error' });
    }
    const data = await response.json();
    if (data.outcome !== 'slot') return res.status(200).json({ outcome: 'no_offer', reason: data.reason || 'none' });
    return res.status(200).json({
      outcome: 'slot',
      jobTypeName: data.jobTypeName,
      date: data.date,
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
    });
  } catch (err) {
    console.error('Could not reach scheduler for a slot', err);
    return res.status(200).json({ outcome: 'no_offer', reason: 'unreachable' });
  }
}
