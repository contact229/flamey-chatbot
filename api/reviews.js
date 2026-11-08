// Vercel serverless function: /api/reviews
// Fetches the business's Google rating and reviews from the Google Places API
// (New) and serves them to reviews.html. The API key stays on the server.
// Vercel caches the answer for a day, so Google is asked about once a day,
// however many people visit the website.
//
// Vercel environment variables:
//   GOOGLE_PLACES_API_KEY  - a Google Cloud API key restricted to the Places API (New)
//   GOOGLE_PLACE_ID        - optional; defaults to Wrights Heating & Gas Services

const DEFAULT_PLACE_ID = 'ChIJCRaDx4GKekgRp_fiRwOmC3I';
const ONE_DAY = 86400;

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function httpsUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en-GB&regionCode=GB`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'displayName,rating,userRatingCount,googleMapsUri,reviews',
        },
      }
    );

    if (!response.ok) {
      console.error('Google Places request failed', response.status, await response.text());
      res.setHeader('Cache-Control', 'public, s-maxage=600'); // retry in 10 minutes, not on every visit
      return res.status(200).json({ ok: false, reason: 'google_error' });
    }

    const place = await response.json();
    const reviews = (place.reviews || []).map(r => ({
      author: text(r.authorAttribution && r.authorAttribution.displayName, 80) || 'Google user',
      authorUri: httpsUrl(r.authorAttribution && r.authorAttribution.uri),
      photo: httpsUrl(r.authorAttribution && r.authorAttribution.photoUri),
      rating: Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0))),
      when: text(r.relativePublishTimeDescription, 40),
      text: text((r.originalText && r.originalText.text) || (r.text && r.text.text), 1500),
      reviewUri: httpsUrl(r.googleMapsUri),
    })).filter(r => r.text);

    res.setHeader('Cache-Control', `public, s-maxage=${ONE_DAY}, stale-while-revalidate=${ONE_DAY}`);
    return res.status(200).json({
      ok: true,
      name: text(place.displayName && place.displayName.text, 120),
      rating: Number(place.rating) || null,
      count: Number(place.userRatingCount) || 0,
      mapsUri: httpsUrl(place.googleMapsUri),
      reviews,
    });
  } catch (err) {
    console.error('Could not reach Google Places', err);
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(200).json({ ok: false, reason: 'unreachable' });
  }
}
