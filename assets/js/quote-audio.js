/* Home page quote audio: one random clip per visit with a caption that
   sweeps right to left once, paced by the track duration. A first visit is
   asked before anything plays: the clip is selected silently and the site's
   own consent dialog opens even when the browser would have allowed
   autoplay. Only a stored answer lets a later visit try autoplay, and a
   browser that still blocks it is reported in the inline status, never with
   a fake browser permission request. The Reset sound control forgets the
   stored answer and asks again; it is website UI, not a browser permission
   request. */
(function () {
  'use strict';

  var STORAGE_KEY = 'quote-audio-muted';
  var LEGACY_PROMPT_KEY = 'quote-audio-prompt-seen';
  var VOLUME = 0.35;
  var STATUS_BLOCKED = 'Your browser blocked autoplay. Press Play or reset your sound choice.';
  var STATUS_FAILED = 'Audio unavailable.';

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, false);
    } else {
      callback();
    }
  }

  function prefersReducedMotion() {
    if (typeof window.matchMedia !== 'function') {
      return false;
    }
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  function readTracks(root) {
    var tracks = [];
    var raw = root.getAttribute('data-quote-audio-tracks');
    var parsed;
    var i;
    if (!raw) {
      return tracks;
    }
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return tracks;
    }
    if (!parsed || typeof parsed.length !== 'number') {
      return tracks;
    }
    for (i = 0; i < parsed.length; i += 1) {
      var item = parsed[i];
      var file;
      var title;
      if (!item || typeof item.src !== 'string' || item.src === '') {
        continue;
      }
      file = typeof item.file === 'string' ? item.file : '';
      title = typeof item.title === 'string' && item.title !== '' ? item.title : file;
      tracks.push({
        src: item.src,
        title: title,
        caption: typeof item.caption === 'string' && item.caption !== '' ? item.caption : title
      });
    }
    return tracks;
  }

  /* localStorage is the shared store; sessionStorage is only a fallback for
     browsers that deny localStorage outright, and a plain object keeps the
     player coherent for the rest of the page when every storage is denied.
     A readable localStorage without a valid player key is authoritative
     UNKNOWN: it must never resurrect an old sessionStorage answer, so
     muted() returns null and the first-visit question still asks. Only an
     answer in a readable layer, or the page-memory fallback, keeps the
     prompt from asking again. */
  function quoteAudioStore() {
    var memory = { muted: null };
    var layerNames = ['localStorage', 'sessionStorage'];
    var keys = [STORAGE_KEY, LEGACY_PROMPT_KEY];

    function layer(name) {
      try {
        return window[name] || null;
      } catch (error) {
        /* Reading the property itself can throw when storage is denied. */
        return null;
      }
    }

    function readKey(storage, key) {
      var result = { read: false, value: null };
      if (!storage) {
        return result;
      }
      try {
        result.value = storage.getItem(key);
        result.read = true;
      } catch (error) {
        result.read = false;
      }
      return result;
    }

    function readChoice() {
      var found = readKey(layer('localStorage'), STORAGE_KEY);
      if (!found.read) {
        found = readKey(layer('sessionStorage'), STORAGE_KEY);
      }
      if (!found.read) {
        return memory.muted;
      }
      if (found.value === '1') {
        return true;
      }
      if (found.value === '0') {
        return false;
      }
      return null;
    }

    function writeChoice(muted) {
      var value = muted ? '1' : '0';
      var storage;
      var i;
      memory.muted = muted;
      for (i = 0; i < layerNames.length; i += 1) {
        storage = layer(layerNames[i]);
        if (!storage) {
          continue;
        }
        try {
          storage.setItem(STORAGE_KEY, value);
        } catch (error) {
          /* The other layer, or memory, still covers this page. */
        }
      }
    }

    /* Reset forgets only the player's own keys. One failing layer must not
       stop the other keys or layers, and memory stays usable afterwards. */
    function forgetChoice() {
      var storage;
      var i;
      var j;
      memory.muted = null;
      for (i = 0; i < layerNames.length; i += 1) {
        storage = layer(layerNames[i]);
        if (!storage) {
          continue;
        }
        for (j = 0; j < keys.length; j += 1) {
          try {
            storage.removeItem(keys[j]);
          } catch (error) {
            /* Keep clearing the remaining keys and layers. */
          }
        }
      }
    }

    return {
      muted: readChoice,
      rememberMuted: writeChoice,
      forgetMuted: forgetChoice
    };
  }

  function pickIndex(count, exclude) {
    var available;
    var index;
    if (count <= 1) {
      return 0;
    }
    available = count - (exclude >= 0 && exclude < count ? 1 : 0);
    index = Math.floor(Math.random() * available);
    if (!(index >= 0)) {
      index = 0;
    }
    if (index > available - 1) {
      index = available - 1;
    }
    if (exclude >= 0 && exclude < count && index >= exclude) {
      index += 1;
    }
    return index;
  }

  function initPlayer(root) {
    var tracks = readTracks(root);
    var viewport = root.querySelector('[data-quote-audio-viewport]');
    var caption = root.querySelector('[data-quote-audio-caption]');
    var title = root.querySelector('[data-quote-audio-title]');
    var statusNode = root.querySelector('[data-quote-audio-status]');
    var playButton = root.querySelector('[data-quote-audio-play]');
    var nextButton = root.querySelector('[data-quote-audio-next]');
    var soundButton = root.querySelector('[data-quote-audio-sound]');
    var resetButton = root.querySelector('[data-quote-audio-reset]');
    var prompt = root.querySelector('[data-quote-audio-prompt]');
    var promptPlay = root.querySelector('[data-quote-audio-prompt-play]');
    var promptContinue = root.querySelector('[data-quote-audio-prompt-continue]');
    var store;
    var storedMuted;
    var state;

    if (!tracks.length || !caption) {
      root.hidden = true;
      return;
    }

    store = quoteAudioStore();
    storedMuted = store.muted();
    state = {
      audio: null,
      index: -1,
      muted: storedMuted === true,
      soundChosen: storedMuted !== null,
      frame: 0,
      token: 0,
      staticCaption: prefersReducedMotion(),
      geometry: null,
      promptOpen: false,
      promptDismissed: false,
      focusReturn: null
    };

    function setStatus(message) {
      if (statusNode) {
        statusNode.textContent = message || '';
      }
    }

    function isPlaying() {
      return !!state.audio && !state.audio.paused && !state.audio.ended;
    }

    function syncControls() {
      if (playButton) {
        playButton.textContent = isPlaying() ? 'Pause' : 'Play';
      }
      if (nextButton) {
        nextButton.disabled = tracks.length < 2;
      }
      if (soundButton) {
        soundButton.textContent = state.muted ? 'Sound off' : 'Sound on';
        soundButton.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
        soundButton.setAttribute('title', state.muted ? 'Turn sound on' : 'Turn sound off');
      }
    }

    /* The sound prompt is plain site UI: a small <dialog> where support
       exists, the same markup rendered as an inline panel where it does not. */
    function dialogApi() {
      return !!prompt && typeof prompt.showModal === 'function' && typeof prompt.close === 'function';
    }

    function restorePromptFocus() {
      var target = state.focusReturn || playButton;
      state.focusReturn = null;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        try {
          target.focus();
        } catch (error) {
          /* Focus can be refused while the document is not active. */
        }
      }
    }

    function hidePrompt() {
      var wasOpen = state.promptOpen;
      if (!prompt) {
        return;
      }
      state.promptOpen = false;
      if (dialogApi() && prompt.open) {
        try {
          prompt.close();
        } catch (error) {
          prompt.removeAttribute('open');
        }
      } else {
        prompt.removeAttribute('open');
      }
      prompt.hidden = true;
      prompt.classList.remove('quote-audio__prompt--inline');
      if (wasOpen) {
        restorePromptFocus();
      }
    }

    /* The first-visit question opens before any play() attempt and stays up
       until the visitor answers or dismisses it for this page. */
    function showPrompt() {
      if (!prompt || state.promptOpen || state.promptDismissed) {
        return;
      }
      state.promptOpen = true;
      state.focusReturn = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : playButton;
      prompt.hidden = false;
      if (dialogApi()) {
        try {
          prompt.showModal();
          return;
        } catch (error) {
          /* Fall through to the inline panel below. */
        }
      }
      prompt.setAttribute('open', '');
      prompt.classList.add('quote-audio__prompt--inline');
      if (promptPlay && typeof promptPlay.focus === 'function') {
        try {
          promptPlay.focus();
        } catch (error) {
          /* The inline panel stays usable even when focus is refused. */
        }
      }
    }

    function stopMotion() {
      if (state.frame && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(state.frame);
      }
      state.frame = 0;
    }

    function measureCaption() {
      state.geometry = {
        viewportWidth: viewport ? viewport.getBoundingClientRect().width : 0,
        /* A nowrap block still reports the container width, so use the widest
           rendered/overflow width to make long captions exit completely. */
        captionWidth: Math.max(caption.scrollWidth, caption.offsetWidth, caption.getBoundingClientRect().width)
      };
    }

    function restCaption() {
      stopMotion();
      state.geometry = null;
      caption.classList.remove('is-sweeping');
      caption.style.transform = '';
    }

    function drawCaption() {
      var audio = state.audio;
      var duration = audio ? audio.duration : 0;
      var progress;
      var distance;
      var offset;
      if (state.staticCaption || !state.geometry) {
        return;
      }
      if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) {
        return;
      }
      progress = audio.currentTime / duration;
      if (!(progress >= 0)) {
        progress = 0;
      }
      if (progress > 1) {
        progress = 1;
      }
      distance = state.geometry.viewportWidth + state.geometry.captionWidth;
      offset = state.geometry.viewportWidth - distance * progress;
      caption.style.transform = offset === 0 ? '' : 'translateX(' + offset.toFixed(1) + 'px)';
    }

    function startMotion(token) {
      var step;
      if (state.staticCaption || typeof window.requestAnimationFrame !== 'function') {
        return;
      }
      caption.classList.add('is-sweeping');
      measureCaption();
      stopMotion();
      step = function () {
        if (token !== state.token) {
          return;
        }
        state.frame = window.requestAnimationFrame(step);
        drawCaption();
      };
      state.frame = window.requestAnimationFrame(step);
    }

    function handlePlayFailure(token, error) {
      var name = error && error.name ? error.name : '';
      if (token !== state.token) {
        return;
      }
      syncControls();
      if (name === 'AbortError') {
        return;
      }
      if (name === 'NotAllowedError') {
        /* The visitor already allowed sound; when the browser still refuses,
           the inline status is the only truthful place to say so. A late
           rejection that lands after sound was turned off says nothing. */
        setStatus(state.muted ? '' : STATUS_BLOCKED);
        return;
      }
      /* Media problems (missing file, unsupported codec) never raise the
         consent prompt; the status line reports them and Next can pick
         another clip. */
      restCaption();
      setStatus(STATUS_FAILED);
    }

    function attemptPlay(token) {
      var audio = state.audio;
      var result;
      if (!audio) {
        return;
      }
      try {
        result = audio.play();
      } catch (error) {
        handlePlayFailure(token, error);
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(function () {
          if (token === state.token) {
            setStatus('');
            syncControls();
            hidePrompt();
          }
        }, function (error) {
          handlePlayFailure(token, error);
        });
      } else {
        syncControls();
      }
    }

    function resumePlayback() {
      var audio = state.audio;
      if (!audio) {
        return;
      }
      if (audio.ended) {
        try {
          audio.currentTime = 0;
        } catch (error) {
          /* Ignore seek failures before metadata is ready. */
        }
        restCaption();
      }
      attemptPlay(state.token);
    }

    function bindMedia(audio, token) {
      audio.addEventListener('play', function () {
        if (token === state.token) {
          syncControls();
        }
      });
      audio.addEventListener('playing', function () {
        if (token !== state.token) {
          return;
        }
        setStatus('');
        syncControls();
        hidePrompt();
        startMotion(token);
      });
      audio.addEventListener('pause', function () {
        if (token === state.token) {
          stopMotion();
          syncControls();
        }
      });
      audio.addEventListener('waiting', function () {
        if (token === state.token) {
          stopMotion();
        }
      });
      audio.addEventListener('ended', function () {
        if (token === state.token) {
          restCaption();
          syncControls();
        }
      });
      audio.addEventListener('error', function () {
        if (token !== state.token) {
          return;
        }
        restCaption();
        setStatus(STATUS_FAILED);
        syncControls();
      });
    }

    function loadTrack(index, autoplay) {
      var previous = state.audio;
      var track;
      var audio;
      state.token += 1;
      state.index = index;
      track = tracks[index];
      if (previous) {
        try {
          previous.pause();
        } catch (error) {
          /* A detached element can refuse pause(); the token guard covers it. */
        }
        previous.removeAttribute('src');
        if (previous.parentNode) {
          previous.parentNode.removeChild(previous);
        }
      }
      restCaption();
      caption.textContent = track.caption;
      if (title) {
        title.textContent = track.title;
      }
      setStatus('');
      audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.loop = false;
      audio.volume = VOLUME;
      audio.muted = state.muted;
      audio.setAttribute('src', track.src);
      bindMedia(audio, state.token);
      root.appendChild(audio);
      state.audio = audio;
      syncControls();
      if (autoplay) {
        attemptPlay(state.token);
      }
    }

    /* Any explicit sound choice is remembered in storage
       (quote-audio-muted: 0 sound on, 1 sound off) and closes the first-visit
       question until the Reset sound button forgets the answer. */
    function rememberSoundChoice(on) {
      state.muted = !on;
      state.soundChosen = true;
      store.rememberMuted(state.muted);
      if (state.audio) {
        state.audio.muted = state.muted;
      }
      if (state.promptOpen) {
        hidePrompt();
      }
    }

    function setSound(on) {
      rememberSoundChoice(on);
      if (state.audio) {
        if (state.muted) {
          state.audio.pause();
        } else {
          resumePlayback();
        }
      }
      if (state.muted) {
        /* Turning sound off retires a stale "autoplay blocked" note. */
        setStatus('');
      }
      syncControls();
    }

    function togglePlay() {
      var audio = state.audio;
      if (!audio) {
        return;
      }
      if (!audio.paused && !audio.ended) {
        audio.pause();
        return;
      }
      setSound(true);
    }

    function nextTrack() {
      if (tracks.length > 1) {
        loadTrack(pickIndex(tracks.length, state.index),
          state.soundChosen && !state.muted);
      }
    }

    function toggleSound() {
      setSound(state.muted);
    }

    /* The Reset sound button returns the player to the unknown first-visit
       state: the saved answer is forgotten in both storage layers and in
       memory, pending play callbacks are invalidated by the fresh track
       token, the clip is reloaded paused, and the question opens again
       before any new play attempt. It is website state, not a browser
       permission reset. */
    function resetSoundChoice() {
      store.forgetMuted();
      state.muted = false;
      state.soundChosen = false;
      state.promptDismissed = false;
      loadTrack(state.index, false);
      showPrompt();
    }

    /* "Allow and play" is the visitor's own sound-on choice: it is stored, the
       dialog closes, and play() runs in this same click task so the user
       gesture still counts. */
    function handlePromptPlay() {
      rememberSoundChoice(true);
      if (!state.audio) {
        syncControls();
        setStatus(STATUS_FAILED);
        return;
      }
      syncControls();
      resumePlayback();
    }

    /* "No sound" stores the off choice and leaves the clip paused. */
    function handlePromptContinue() {
      setSound(false);
    }

    if (playButton) {
      playButton.addEventListener('click', togglePlay);
    }
    if (nextButton) {
      nextButton.addEventListener('click', nextTrack);
    }
    if (soundButton) {
      soundButton.addEventListener('click', toggleSound);
    }
    if (resetButton) {
      resetButton.addEventListener('click', resetSoundChoice);
    }
    if (promptPlay) {
      promptPlay.addEventListener('click', handlePromptPlay);
    }
    if (promptContinue) {
      promptContinue.addEventListener('click', handlePromptContinue);
    }
    if (prompt) {
      prompt.addEventListener('cancel', function () {
        /* Escape (or another cancel) keeps the prompt closed for this page. */
        state.promptDismissed = true;
      });
      prompt.addEventListener('close', function () {
        var wasOpen = state.promptOpen;
        state.promptOpen = false;
        prompt.hidden = true;
        prompt.classList.remove('quote-audio__prompt--inline');
        if (wasOpen) {
          restorePromptFocus();
        }
      });
      prompt.addEventListener('keydown', function (event) {
        if (!prompt.classList.contains('quote-audio__prompt--inline') ||
            (event.key !== 'Escape' && event.key !== 'Esc')) {
          return;
        }
        event.preventDefault();
        state.promptDismissed = true;
        hidePrompt();
      });
    }
    window.addEventListener('resize', function () {
      if (isPlaying() && !state.staticCaption) {
        measureCaption();
        drawCaption();
      }
    });

    /* The first visit never plays before the answer: the clip is selected
       silently and the question opens even when the browser would have
       allowed autoplay. */
    loadTrack(pickIndex(tracks.length, -1), state.soundChosen && !state.muted);
    if (!state.soundChosen) {
      showPrompt();
    }
  }

  ready(function () {
    var roots = document.querySelectorAll('[data-quote-audio]');
    var i;
    for (i = 0; i < roots.length; i += 1) {
      initPlayer(roots[i]);
    }
  });
}());
