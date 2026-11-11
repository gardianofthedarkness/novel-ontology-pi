# Novel Console

Novel Console is a Mac app for reading your own EPUB novels with the help of AI.
It reads each book once, then gives you a reader that marks the characters, places and story threads as you go.
You can also open views for each book's characters, places and threads.

Your books stay on your Mac.
The app only adds a small hidden `.novel` folder next to them.

## What you need

- **A Mac with Apple Silicon** (M1 or later). Intel Macs are not supported.
- **Two API keys**, used when a book is read:
  - **Jev**, from TypeSafe AI.
  - **A work model**, from DeepSeek.
- **Optional:** [Claude Code](https://claude.com/claude-code) or Pi, if you want an agent to tidy up your library for you.

## Download and install

1. Go to the **[latest release](https://github.com/gardianofthedarkness/novel-ontology-pi/releases/latest)**.
   Download the file named `Novel-Console-…-arm64.dmg`.
2. Open the DMG and drag **Novel Console** onto the **Applications** folder.
3. Eject the DMG.

### Opening it the first time

The app isn't signed with an Apple developer certificate yet, so macOS blocks it the first time you open it.
You only have to allow it once:

1. Open **Novel Console** from Applications.
   macOS says it can't be opened. Click **Done**.
2. Open **System Settings → Privacy & Security**.
   Scroll down to the Security section.
3. Next to the message about Novel Console, click **Open Anyway**.
   Confirm, then enter your Mac password.

From then on it opens normally.

If you're comfortable with Terminal, this one command does the same thing:

```sh
xattr -dr com.apple.quarantine "/Applications/Novel Console.app"
```

## Getting started

1. **Add your keys.**
   Click **Keys** in the top bar.
   Paste your Jev key and your work-model key, then click **Save**.
   The dots next to Keys turn on when each key is set.
   Keys are kept only on this Mac, readable only by you, and never shown again.
2. **Add a folder of books.**
   Click **Add a folder…** and choose a folder with your EPUBs.
   Plain-text books (`.txt` or `.md`) can be brought in with **Import a text file…** in the Library.
3. **Read a book.**
   In the Library, click **▶** next to a book.
   The app shows the cost before you start.
   It's about $0.35 for a 125,000-character volume and takes a couple of minutes.
   Reading happens in the background, and you can stop it at any time.
4. **Open it in the Reader.**
   Once a book has been read, open it in the **Reader**.
   Names, places, who is speaking and notes are marked in the text.

## Finding your way around

The icons down the left side open the different views:

| View | What it shows |
| --- | --- |
| **Library** | Your folders and their books |
| **Outline** | The open book's chapters and scenes |
| **Search** | Words and names in the open book |
| **Characters** | The people in the book, and the path each one takes |
| **Places** | Where things happen, what lies inside what, and who was there |
| **Strands** | Who travels together, where they part, and where they meet again |
| **Record** | One character or place, with every line that mentions them |
| **Problems** | Spots where the reading wasn't sure who said or did something |
| **Reader** | The book itself, with its marks |
| **Readings** | Each book's reading, and your keys |

Other things you can do:

- **Arrange with an agent.**
  In the Library, this asks Claude Code or Pi to sort a folder into universes, series and reading order for you.
  It only uses the app's own folder commands, and you can watch each step in the chat panel.
  If you'd rather do it yourself, use **Arrange**.
- **Chat panel.**
  Open it with **⌘I** to see and continue your agent sessions.
- **Day and night.**
  Click **◐** to switch between light and dark.

## Your privacy

- Your books are never uploaded anywhere by this app, and nothing about them is published.
- The only thing written into your book folder is a hidden `.novel` folder holding the reading results.
- While a book is being read, its text is sent to the two model services (TypeSafe and DeepSeek) using your keys.
  Nothing is sent at any other time.
- You pay those services directly for what a reading uses.

## Help

Something not working? [Open an issue](https://github.com/gardianofthedarkness/novel-ontology-pi/issues).

---

<sub>For developers: how it works is in the [design document](docs/v3/design.html), and the history is in the [milestones](docs/v3/milestones.html).</sub>
