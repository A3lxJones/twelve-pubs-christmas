# 12 Pubs of Christmas

A mobile-first festive route tracker for a 12-pub Christmas event. It is a static HTML, CSS, and JavaScript app with optional Supabase-backed private rooms for organisers and attendees.

## Run locally

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000).

## Supabase setup

1. Open the linked Supabase project.
2. Run `supabase.sql` in the SQL Editor.
3. Use the app's **Profile & settings** panel to create an organiser room.
4. Share the generated attendee invite link.

The browser uses the public Supabase publishable key in `script.js`. Never add a database password or service-role key to frontend code.

## Features

- Persistent personal profile, route checklist, and drink/shot counters
- Private organiser rooms with named meetup spots
- Organiser-only attendee list and partner randomisation
- Group-of-three support for odd attendee counts
- Numbered Belfast route map and directions links
- Global rules, SOS taxi contacts, location sharing, and snowfall theme

## Deployment

This is a static site and can be hosted on GitHub Pages, Netlify, Vercel, or any static web server. The Supabase project remains the shared backend for organiser rooms.
