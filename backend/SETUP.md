# Setting up the backend

**Supabase is the chosen backend.** Do section A — that is the deployment.
Section B is the Apps Script alternative, kept only as a fallback in case
Supabase ever has to be abandoned; you do not need it.

The comparison page that was used to choose between them is still at
**http://localhost:4321/spike.html**.

---

## A. Supabase — the one to do

About ten minutes, once. Steps 1–5 are the project; 6–8 are your own login;
9 is how everyone else gets in.

### The project

1. Go to **supabase.com** → sign in with the FCUSR Google account → **New project**.
   - Name: `fcusr-tracker`
   - Database password: let it generate one, and **save it somewhere safe** —
     this is the database's own password, not a login for the app.
   - Region: **Southeast Asia (Singapore)** — closest to Roxas, so it's fastest.
2. Wait for the project to finish building (a minute or two).
3. Left sidebar → **SQL Editor** → **New query**. Open
   `backend/supabase/schema.sql` from this project, paste the whole file in, press
   **Run**. It creates the tables, the security rules, the enrolment gateway and
   the starting units. Running it twice is safe.
4. Left sidebar → **Project Settings** → **API**. Copy two values:
   - **Project URL**
   - **anon public** key (the long one — it is designed to be public; the
     security rules are what protect the data, not this key)
5. Paste both into `assets/js/backend/config.js`.

### One setting you must change

6. Sidebar → **Authentication** → **Sign In / Providers** → **Email**. Turn
   **Confirm email** *off*, and leave **Allow new users to sign up** *on*.

   This matters more than it looks. Supabase's built-in mail service is rate
   limited to a couple of messages an hour on the free tier — nowhere near four
   hundred officers and volunteers. With confirmation on, almost nobody would
   ever receive their link and the council would spend deployment day unable to
   sign in.

   Turning it off is safe here because **signing up is not how anyone gets
   access**. A new sign-up on an address nobody enrolled produces no profile at
   all: that person can hold a login and see nothing. Access comes only from an
   enrolment an executive recorded first.

### Your own login

7. Sidebar → **Authentication** → **Users** → **Add user** → *Create new user*.
   Use your own email and a password you choose. Tick **Auto Confirm User**.
8. Make that login the founding national officer. **SQL Editor** → **New query**,
   put your email in, and run:

   ```sql
   insert into profiles (id, email, full_name, position, unit_id, access, is_head)
   select u.id, u.email, 'Arron D. Aperocho', 'National President',
          (select id from units where code = 'NAT'), 'officer', true
   from auth.users u where u.email = 'you@example.com'
   on conflict (id) do update
     set access = 'officer', is_head = true, active = true;
   ```

   This is the only account ever made by hand. Everyone else is enrolled from
   inside the app.

### How everyone else gets in

9. Two steps, and they happen in this order on purpose:

   1. **You enrol the address.** In the app: **Settings → Access and enrolment →
      Enrol someone**. Choose their unit, choose officer or volunteer, and for a
      volunteer tick the events they are helping with. This records the decision.
      No login exists yet.
   2. **They set their own password.** They open the site, press **Sign in**,
      choose **Set my password**, and enter the address you enrolled together
      with a password of their own choosing.

   Nobody — not you, not the app, not this file — ever handles another person's
   password. And because the profile is created from *your* enrolment rather than
   from anything they type, no wording in the position field, and no cleverness
   at sign-up, can widen what they reach.

### Checking it worked

Open the app, sign in with your own login, and confirm:

- the header shows your name and **FCUSR Nationals**;
- **Settings** opens (it is executives only);
- **Enrol someone** lists all fifteen units in its picker.

Then enrol a test address, set a password for it in a private window, and check
that it lands as a volunteer seeing only the events you ticked.

To take someone's access away later — turnover, or a volunteer who has left —
run `select withdraw_member('their@email');` in the SQL editor. Their profile is
deactivated rather than deleted, so every task still shows who held it.

## B. Google Apps Script — the fallback, not needed for deployment

1. In the FCUSR Google account, create a new **Google Sheet** named `FCUSR Tracker`.
2. **Extensions → Apps Script**. Delete the sample code.
3. Open `backend/appsscript/Code.gs` from this project, paste the whole file in,
   and save.
4. Press **Run** with `setup` selected in the dropdown. Accept the permission
   prompt. This creates the tabs, the starting units, and makes *you* the founding
   national officer.
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone within Filamer Christian University** (or *Anyone
     with a Google account* if you are not on Workspace)
   - Press **Deploy** and copy the **/exec** URL.
6. Paste that URL into `assets/js/backend/config.js`.
7. On the test page choose **Apps Script** and press **Run the checks**. There is
   no password box — it uses the Google account you are already signed in with.

---

## What you are comparing

| | Supabase | Apps Script |
|---|---|---|
| Cost | ₱0 free tier; ~$25/mo only if you outgrow it | ₱0, always |
| Where the data lives | Supabase's Postgres | A Sheet in *your* Google Drive |
| Sign-in | Its own email + password | The person's Google account |
| Changing a password | In the app | In Google — nothing for us to store |
| Many people at once | Handles it properly | Writes queue up behind a lock |
| Readable without the app | Needs SQL | It's a spreadsheet — anyone can open it |
| Turnover | Hand over the Supabase account | Already in the FCUSR Google account |
| If it's idle for a week | Free projects pause; someone un-pauses | Nothing to pause |

**Speed is the thing to feel for yourself**, especially on mobile data — that is
why the test page times every call.

My expectation, to check against what you actually see: Apps Script will be
noticeably slower per action (roughly 1–3 seconds vs a few hundred milliseconds),
and that gap matters most when several officers are updating statuses during a
meeting. Its advantages — no bill ever, data readable as a spreadsheet, and it
already lives in the account you hand to next year's officers — are real and may
well outweigh the speed for you.

## Note on the jurisdiction rules

Both backends enforce the same table, in the same single place:

| Enroller | May create | Where |
|---|---|---|
| National officer | Officers and volunteers | Anywhere |
| Governor (province head) | **Volunteers only** | Their own province |
| COMELEC Chair | Officers and volunteers | COMELEC only |
| Chief Justice | Officers and volunteers | Judiciary only |

The typed **position is only a label** printed on reports. It grants nothing. A
governor can type any wording they like and the person is still a volunteer in
that governor's own province — so there is no combination of words to find, and
nothing to detect. Worth testing on both: sign in as a province head and try to
enrol an officer. Both should refuse with the same sentence.
