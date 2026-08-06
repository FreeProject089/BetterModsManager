# BetterCommunity


> News & posts from the BetterCommunity blogs, read without leaving BMM.

The **BetterCommunity** screen is the project's blog, brought inside the app: announcements,
release notes, and posts from the people building BMM and its sibling tools. You don't need
an account or a browser to read it — BMM fetches the posts each time you open the page, so
what you see is current without a restart.

It is also the front door to a larger platform. BetterCommunity is the web service behind
[Server Repos](doc-page:features/repo) and the community catalogs the [App Catalog](doc-page:features/apps) reads; this
screen shows its blog, not the whole of it.

<!-- TODO(content): capture + annotate the BetterCommunity screen (feed, filter chips,
     search) as ../assets/screens/community.annotated.png, like the other feature pages. -->

<div class="bmm-replay" data-page="features/community" data-title="Reading the community blog (placeholder clip)"></div>

*Placeholder recording — a focused clip of this screen will replace it.*

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
