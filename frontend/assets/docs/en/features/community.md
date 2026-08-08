# BetterCommunity


> News & posts from the BetterCommunity blogs, read without leaving BMM.

The **BetterCommunity** screen is the project's blog, brought inside the app: announcements,
release notes, and posts from the people building BMM and its sibling tools. You don't need
an account or a browser to read it — BMM fetches the posts each time you open the page, so
what you see is current without a restart.

It is also the front door to a larger platform. BetterCommunity is the web service behind
[Server Repos](doc-page:features/repo) and the community catalogs the [App Catalog](doc-page:features/apps) reads; this
screen shows its blog, not the whole of it.

<!-- TODO(capture): an annotated screenshot of this screen, as
     ../assets/screens/community.annotated.png, like the other feature pages. The text below
     describes the same thing; the capture is a nice-to-have, not a blocker. -->

## What is on the screen

Four things, top to bottom:

| | |
|---|---|
| **Filter chips** | One per blog space — **BMM**, **BSM**, **Installer**, **Community** — plus **All**, which is where the page starts. Nothing is hidden by default |
| **Search** | Filters the posts already loaded, matching the title, the excerpt, *and* the author's name. It narrows what is on screen; it does not query the server |
| **The featured post** | The newest post, given a wide card of its own |
| **The grid** | Everything else, newest first |

The featured card only appears when you are browsing unfiltered and not searching. That is
deliberate: a hero card says "this is the latest news", and it would be a lie if it were merely
the first row that happened to match your search.

There is also a **language switch for the posts**, separate from BMM's own. Blog content exists
in English and French; if BMM is set to a third language the posts fall back to English, and
you can still flip them by hand.

## When there is nothing to show

Three different empty states, because three different things can be true:

- **Nothing in this section yet, but posts exist elsewhere** — you get a *Show all posts*
  button rather than a dead end.
- **Nothing at all yet** — a plain message.
- **Could not load** — a *Retry* button. The feed comes from the network, so this is the state
  you will see offline, and it says so instead of pretending the blog is empty.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/community.bmmreplay" data-page="features/community" data-title="Reading the community blog"></div>


## The feed

Opening the page loads every post into a single scrollable feed, newest first. Each card
shows the post's title, an excerpt, its authors, the project it belongs to, and its reaction
and comment counts. Click a card to open the full post.

BMM **re-fetches the feed every time you enter the page**, so a freshly published post
appears the next time you visit — no "refresh" button to hunt for. If the fetch fails (you're
offline, or the platform is unreachable), the page says so and offers **Retry** rather than
showing a stale or empty list.

### Filtering by project

BetterCommunity carries the blogs of the whole tool family, so the feed is filtered by a row
of chips at the top:

| Chip | Shows |
|---|---|
| **All** | Every project's posts (the default — you don't have to click anything). |
| **BMM** | Better Mods Manager. |
| **BSM** | BetterSaveManager. |
| **Installer** | BetterInstaller. |
| **Community** | Platform-wide and community posts. |

The **All** filter is selected on arrival deliberately: the common case is "what's new
anywhere", so nothing is hidden until you choose to narrow it.

### Search

The search box filters the current list as you type, matching against each post's **title**,
its **excerpt**, and its **authors' names**. Search and the project filter combine — search
within *BMM* only by picking the chip first, then typing.

## Reading a post

Clicking a card opens the full article: the rendered post body (images and video included),
its author row, and the interaction controls below. The post view manages its own screen, so
you can read comfortably; leaving it returns you to the feed where you left off.

### Reactions

A post can be reacted to with one of ten icons — 👍 thumbs-up, ❤️ heart, 🔥 fire, 🎉 party,
⭐ star, 🚀 rocket, 😂 laugh, 🙂 smile, ✨ sparkles, and ✅ check. Reactions are a quick,
low-effort signal; the counts you see on a card are the totals across everyone who reacted.

### Comments

Posts carry a comment thread, so a release note or announcement can hold a conversation in
place instead of scattering it across other channels.

### Edit history

Posts are not frozen once published. When a post has been edited, BMM can show you **what
changed** — a line-by-line diff between versions, with added and removed lines marked. A
correction or an updated announcement is therefore transparent: you see the before and after,
not just the latest text.

!!! note "Co-authored posts"

    A post can list **several authors**. The author row shows each contributor, so a
    collaborative announcement credits everyone who worked on it, not just whoever clicked
    publish.

## How it fits the rest of BMM

The blog is the visible tip of BetterCommunity. The same platform:

- hosts **community catalogs** the [App Catalog](doc-page:features/apps) can subscribe to;
- backs the shareable **[Server Repos](doc-page:features/repo)** you sync mods from;
- is where projects publish the release notes you also see under **What's New** in BMM.

So a post here announcing "new repo available" or "catalog updated" points at features you
act on elsewhere in the app — this screen is where you hear about them first.
