# Putting the tracker online

Two halves, and they are independent. The site can go up before the backend
exists — it simply keeps each person's data on their own device until it does.

## A. The site (GitHub Pages)

1. **GitHub Desktop → File → Add Local Repository…** and choose this folder.
   It is already a git repository with its history, so Desktop will pick it up
   rather than asking to create one.
2. Press **Publish repository**.
   - Name: `fcusr-task-tracker`
   - **Untick "Keep this code private"** — GitHub Pages is free only for public
     repositories. There are no passwords in this code; the Supabase anon key is
     designed to be public and the database rules are what protect the data.
3. On **github.com**, open the repository → **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)** → **Save**
4. Wait a minute or two. The address appears on that same page:
   `https://<your-username>.github.io/fcusr-task-tracker/`

To publish a change afterwards: commit in GitHub Desktop, press **Push origin**.
The live site follows within a minute.

## B. The backend (Supabase)

See `backend/supabase/SETUP.md` — or the short version:

1. **supabase.com** → New project → name `fcusr-tracker`, region
   **Southeast Asia (Singapore)**. Save the database password somewhere safe.
2. **SQL Editor → New query** → paste all of `backend/supabase/schema.sql` → Run.
3. **Authentication → Sign In / Providers → Email** → turn **Confirm email OFF**.
   Supabase's free mailer sends about two messages an hour; with four hundred
   students almost nobody would receive their link. Turning it off is safe
   because signing up grants nothing on its own — only an enrolment does.
4. **Project Settings → API** → copy the **Project URL** and the **anon public**
   key into `assets/js/backend/config.js`.
5. Commit and push. The login page appears the moment those two values are set.

Never put the **database password** or the **service_role** key in this project.
Neither is needed, and both would be readable by anyone.

## What works before the backend exists

Everything, on one device at a time. Each browser keeps its own copy, so two
officers see two different sets of records. The dry run is designed for exactly
this: rehearse the end of term on invented data, then end it from Settings once
the backend is live and the council is ready for real work.
