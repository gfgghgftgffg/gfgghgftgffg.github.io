/* Home page quote audio: one random clip per visit with a caption that
   sweeps right to left once, paced by the track duration. Audible autoplay
   can be blocked by the browser; that case shows the site's own sound
   prompt, never a fake browser permission request. */
(function () {
  'use strict';

  var STORAGE_KEY = 'quote-audio-muted';
  var VOLUME = 0.35;
  var PROMPT_BLOCKED = 'The browser blocked playback. Press "Play audio" to try again.';
  var PROMPT_FAILED = 'This voice line could not be played. Press "Play audio" to try again, or continue without sound.';
  var STATUS_BLOCKED = 'Autoplay blocked. Press Play to listen.';
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

  function mutedStore() {
    var memory = false;
    return {
      read: function () {
        try {
          var stored = window.localStorage.getItem(STORAGE_KEY);
          if (stored === '1') {
            return true;
          }
          if (stored === '0') {
            return false;
          }
        } catch (error) {
          /* Storage can be unavailable (private mode, blocked cookies). */
        }
        return memory;
      },
      write: function (muted) {
        memory = muted;
        try {
          window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
        } catch (error) {
          /* Keep the in-memory value when storage rejects the write. */
        }
      }
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
    var prompt = root.querySelector('[data-quote-audio-prompt]');
    var promptPlay = root.querySelector('[data-quote-audio-prompt-play]');
    var promptContinue = root.querySelector('[data-quote-audio-prompt-continue]');
    var promptError = root.querySelector('[data-quote-audio-prompt-error]');
    var store;
    var state;

    if (!tracks.length || !caption) {
      root.hidden = true;
      return;
    }

    store = mutedStore();
    state = {
      audio: null,
      index: -1,
      muted: store.read(),
      frame: 0,
      token: 0,
      staticCaption: prefersReducedMotion(),
      geometry: null,
      promptOpen: false,
      promptDismissed: false,
      promptPlayAttempted: false,
      mediaFailed: false,
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

    function setPromptError(message) {
      if (!promptError) {
        return;
      }
      if (message) {
        promptError.textContent = message;
        promptError.hidden = false;
      } else {
        promptError.textContent = '';
        promptError.hidden = true;
      }
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
      setPromptError('');
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

    function showPrompt() {
      if (!prompt || state.promptOpen || state.promptDismissed) {
        return;
      }
      state.promptOpen = true;
      state.promptPlayAttempted = false;
      setPromptError('');
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

    function canPrompt() {
      return !!prompt && !state.muted && !state.promptDismissed && !state.mediaFailed &&
        !(state.audio && state.audio.error);
    }

    /* A clip that fails to load must not leave the prompt sitting there: only
       a failed attempt the visitor started from the prompt keeps it open, with
       the error shown inside the prompt itself. */
    function reportPromptFailure() {
      if (!state.promptOpen) {
        return;
      }
      if (state.promptPlayAttempted) {
        setPromptError(PROMPT_FAILED);
      } else {
        hidePrompt();
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
        if (state.promptOpen) {
          setPromptError(PROMPT_BLOCKED);
          return;
        }
        if (canPrompt()) {
          showPrompt();
          return;
        }
        setStatus(STATUS_BLOCKED);
        return;
      }
      /* Media problems (missing file, unsupported codec) never raise the
         prompt. An initial load failure closes it; only a failure of the
         visitor's own Play action stays open with the error inside. */
      state.mediaFailed = true;
      restCaption();
      setStatus(STATUS_FAILED);
      reportPromptFailure();
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
        state.mediaFailed = true;
        restCaption();
        setStatus(STATUS_FAILED);
        reportPromptFailure();
        syncControls();
      });
    }

    function loadTrack(index, autoplay) {
      var previous = state.audio;
      var track;
      var audio;
      state.token += 1;
      state.index = index;
      state.mediaFailed = false;
      state.promptPlayAttempted = false;
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
      if (state.promptOpen) {
        setPromptError('');
      }
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

    function setSound(on) {
      state.muted = !on;
      store.write(state.muted);
      if (state.audio) {
        state.audio.muted = state.muted;
        if (state.muted) {
          state.audio.pause();
          hidePrompt();
        } else {
          resumePlayback();
        }
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
      if (state.muted) {
        setSound(true);
        return;
      }
      resumePlayback();
    }

    function nextTrack() {
      if (tracks.length > 1) {
        loadTrack(pickIndex(tracks.length, state.index), !state.muted);
      }
    }

    function toggleSound() {
      setSound(state.muted);
    }

    function handlePromptPlay() {
      setPromptError('');
      state.promptPlayAttempted = true;
      if (state.muted) {
        state.muted = false;
        store.write(false);
        if (state.audio) {
          state.audio.muted = false;
        }
        syncControls();
      }
      if (!state.audio) {
        setPromptError(PROMPT_FAILED);
        return;
      }
      /* play() runs inside this click task, so the user gesture still counts. */
      resumePlayback();
    }

    function handlePromptContinue() {
      state.promptDismissed = true;
      setSound(false);
      hidePrompt();
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
        setPromptError('');
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

    loadTrack(pickIndex(tracks.length, -1), !state.muted);
  }

  ready(function () {
    var roots = document.querySelectorAll('[data-quote-audio]');
    var i;
    for (i = 0; i < roots.length; i += 1) {
      initPlayer(roots[i]);
    }
  });
}());
