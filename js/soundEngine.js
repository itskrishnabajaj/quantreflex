/**
 * soundEngine.js — Centralized sound playback manager
 *
 * Preloads sound files and provides instant playback.
 * Respects the sound toggle setting from localStorage.
 * Prevents overlapping sounds by stopping previous playback.
 */

var SoundEngine = (function () {
  var sounds = {};
  var soundFiles = {
    drillEnd: 'sounds/drillend.mp3',
    settingsToggle: 'sounds/settingstoggle.mp3',
    tableModal: 'sounds/tablemodalopeningandclosing.mp3',
    tabSwitch: 'sounds/tabswitching.mp3',
    wrongAnswer: 'sounds/wronganswer.mp3'
  };

  /** Check if sound is enabled in settings */
  function isSoundEnabled() {
    try {
      var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
      return s.sound !== false;
    } catch (_) { return true; }
  }

  /** Preload all sound files */
  function preload() {
    var keys = Object.keys(soundFiles);
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = soundFiles[key];
        sounds[key] = audio;
      })(keys[i]);
    }
  }

  /**
   * Play a sound by key.
   * @param {string} key - Sound key (drillEnd, settingsToggle, tableModal, tabSwitch, wrongAnswer)
   */
  function play(key) {
    if (!isSoundEnabled()) return;
    var audio = sounds[key];
    if (!audio) return;
    /* Stop and reset to allow rapid re-triggering */
    audio.pause();
    audio.currentTime = 0;
    audio.play().catch(function () { /* ignore autoplay restrictions */ });
  }

  /* Preload on script load */
  preload();

  return {
    play: play,
    isSoundEnabled: isSoundEnabled
  };
})();
