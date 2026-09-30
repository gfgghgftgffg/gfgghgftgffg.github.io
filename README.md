A Github Pages template for academic websites. This was forked (then detached) by [Stuart Geiger](https://github.com/staeiou) from the [Minimal Mistakes Jekyll Theme](https://mmistakes.github.io/minimal-mistakes/), which is © 2016 Michael Rose and released under the MIT License. See LICENSE.md.

I think I've got things running smoothly and fixed some major bugs, but feel free to file issues or make pull requests if you want to improve the generic template / theme.

### Note: if you are using this repo and now get a notification about a security vulnerability, delete the Gemfile.lock file. 

# Instructions

1. Register a GitHub account if you don't have one and confirm your e-mail (required!)
1. Fork [this repository](https://github.com/academicpages/academicpages.github.io) by clicking the "fork" button in the top right. 
1. Go to the repository's settings (rightmost item in the tabs that start with "Code", should be below "Unwatch"). Rename the repository "[your GitHub username].github.io", which will also be your website's URL.
1. Set site-wide configuration and create content & metadata (see below -- also see [this set of diffs](http://archive.is/3TPas) showing what files were changed to set up [an example site](https://getorg-testacct.github.io) for a user with the username "getorg-testacct")
1. Upload any files (like PDFs, .zip files, etc.) to the files/ directory. They will appear at https://[your GitHub username].github.io/files/example.pdf.  
1. Check status by going to the repository settings, in the "GitHub pages" section
1. (Optional) Use the Jupyter notebooks or python scripts in the `markdown_generator` folder to generate markdown files for publications and talks from a TSV file.

See more info at https://academicpages.github.io/

## Homepage quote audio

The home page plays one random clip from `assets/audio/quotes/`. Keep that folder
flat: only files directly inside it are discovered, and nested subfolders are
ignored. Files with the `.mp3`, `.ogg`, `.wav` or `.m4a` extension are
discovered automatically, and the title and caption for each clip live in
`_data/quote_audio.yml`, keyed by the
filename:

```yaml
my-clip.mp3:
  title: "Short label"
  caption: "Caption text"
```

A file without an entry falls back to its filename for the caption and for
its metadata title, so dropping the audio file in place is enough to get
started. The first visit is asked before the player makes any sound: it
selects a clip silently and opens the site's own dialog (`Enable voice
lines?`, with `Allow and play` and `No sound`) even when the browser would
permit autoplay, so no playback is requested before the answer. The answer is
stored in `localStorage` (`quote-audio-muted`: `0` sound on, `1` sound off);
`sessionStorage` is only read when the browser denies `localStorage` outright,
and a page that loses both storages keeps the choice in memory until the next
reload. With sound on, every later home page visit and refresh tries an
audible autoplay at a modest volume; if the browser still blocks it, the
inline status line says `Your browser blocked autoplay. Press Play or reset
your sound choice.`, because the browser offers no lasting autoplay permission
the site could request, and a blocked refresh only shows that line instead of
reopening the dialog for a stored answer. With sound off nothing plays until
the visitor turns it on again; pressing Play stores sound on and starts the
clip, and the Sound button flips the stored choice. The `Reset sound` control
(labelled "Reset saved sound choice" for screen readers) forgets only the
player's own keys from both storage layers and from memory, pauses the clip,
and reopens the question before anything plays, so it is the way to change an
answer after the dialog is gone. It is website state, not a browser permission
reset: resetting site permissions in the browser does not clear these stored
keys, and the page cannot grant itself autoplay permission. Escape only closes
the dialog for the current page without storing an answer, so an unanswered
first visit is asked again on a later visit. The dialog is site UI, not a
browser permission prompt: it never imitates browser chrome or asks for
microphone access. The caption sweeps right to left once over the track
duration and returns to a readable static position at the end (no motion when
`prefers-reduced-motion: reduce` is set).

`ciallo.mp3` is from the CialloVocals repository:
https://github.com/NINEMINEsigma/CialloVocals/blob/main/ciallo%20vocal%20(1).mp3

`ciallo-cc.m4a` is the audio served by https://ciallo.cc/ (source
`audio#offline-sound-press`), remuxed from AAC into an m4a container without
re-encoding.

## To run locally (not on GitHub Pages, to serve on your own computer)

1. Clone the repository and made updates as detailed above
1. Make sure you have ruby-dev, bundler, and nodejs installed: `sudo apt install ruby-dev ruby-bundler nodejs`
1. Run `bundle clean` to clean up the directory (no need to run `--force`)
1. Run `bundle install` to install ruby dependencies. If you get errors, delete Gemfile.lock and try again.
1. Run `bundle exec jekyll liveserve` to generate the HTML and serve it from `localhost:4000` the local server will automatically rebuild and refresh the pages on change.

# Changelog -- bugfixes and enhancements

There is one logistical issue with a ready-to-fork template theme like academic pages that makes it a little tricky to get bug fixes and updates to the core theme. If you fork this repository, customize it, then pull again, you'll probably get merge conflicts. If you want to save your various .yml configuration files and markdown files, you can delete the repository and fork it again. Or you can manually patch. 

To support this, all changes to the underlying code appear as a closed issue with the tag 'code change' -- get the list [here](https://github.com/academicpages/academicpages.github.io/issues?q=is%3Aclosed%20is%3Aissue%20label%3A%22code%20change%22%20). Each issue thread includes a comment linking to the single commit or a diff across multiple commits, so those with forked repositories can easily identify what they need to patch.
