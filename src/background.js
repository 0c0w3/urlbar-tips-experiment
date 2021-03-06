/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The possible study branches.
const BRANCHES = {
  CONTROL: "control",
  TREATMENT: "treatment",
};

// The possible tips to show.
const TIPS = {
  NONE: "",
  ONBOARD: "onboard",
  REDIRECT: "redirect",
};

// This maps engine names to their homepages.  We show the redirect tip on these
// pages.  It's important to take into account the international versions of
// domains because we don't want to exclude anyone.  Google has a number of
// them.  Bing and DDG do too, but they redirect to the .com in both cases.
// This experiment doesn't target any countries in particular, but it does
// target all of the Firefox English locales: en-US, en-CA, en-GB, en-ZA.
// Therefore we include most of the Google domains for countries where English
// is spoken.  Keep in mind that if someone in one of these countries is using a
// non-English-locale Firefox, they won't be enrolled in the experiment.  This
// list is taken from
// https://ipfs.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco/wiki/List_of_Google_domains.html.
// It's probably not exhaustive, but it's pretty long.
const SUPPORTED_ENGINES = new Map([
  ["Bing", ["www.bing.com"]],
  ["DuckDuckGo", ["duckduckgo.com", "start.duckduckgo.com"]],
  [
    "Google",
    [
      // Ascension Island
      "www.google.ac",
      "www.google.ac/webhp",
      // American Samoa
      "www.google.as",
      "www.google.as/webhp",
      // Anguilla
      "www.google.com.ai",
      "www.google.com.ai/webhp",
      // Australia
      "www.google.com.au",
      "www.google.com.au/webhp",
      // Bahamas
      "www.google.bs",
      "www.google.bs/webhp",
      // British Virgin Islands
      "www.google.vg",
      "www.google.vg/webhp",
      // Canada
      "www.google.ca",
      "www.google.ca/webhp",
      // Cook Islands
      "www.google.co.ck",
      "www.google.co.ck/webhp",
      // Federated States of Micronesia
      "www.google.fm",
      "www.google.fm/webhp",
      // Fiji
      "www.google.com.fj",
      "www.google.com.fj/webhp",
      // Jamaica
      "www.google.com.jm",
      "www.google.com.jm/webhp",
      // Jersey
      "www.google.je",
      "www.google.je/webhp",
      // Kiribati
      "www.google.ki",
      "www.google.ki/webhp",
      // Ireland
      "www.google.ie",
      "www.google.ie/webhp",
      // Isle of Man
      "www.google.im",
      "www.google.im/webhp",
      // New Zealand
      "www.google.co.nz",
      "www.google.co.nz/webhp",
      // Puerto Rico
      "www.google.com.pr",
      "www.google.com.pr/webhp",
      // Montserrat
      "www.google.ms",
      "www.google.ms/webhp",
      // Norfolk Island
      "www.google.com.nf",
      "www.google.com.nf/webhp",
      // Papua New Guinea
      "www.google.com.pg",
      "www.google.com.pg/webhp",
      // Philippines
      "www.google.com.ph",
      "www.google.com.ph/webhp",
      // Pitcairn Islands
      "www.google.pn",
      "www.google.pn/webhp",
      // Singapore
      "www.google.com.sg",
      "www.google.com.sg/webhp",
      // Saint Helena, Ascension and Tristan da Cunha
      "www.google.sh",
      "www.google.sh/webhp",
      // Saint Vincent and the Grenadines
      "www.google.com.vc",
      "www.google.com.vc/webhp",
      // Samoa
      "www.google.ws",
      "www.google.ws/webhp",
      // Sierra Leone
      "www.google.com.sl",
      "www.google.com.sl/webhp",
      // Solomon Islands
      "www.google.com.sb",
      "www.google.com.sb/webhp",
      // South Africa
      "www.google.co.za",
      "www.google.co.za/webhp",
      // Tonga
      "www.google.to",
      "www.google.to/webhp",
      // Trinidad and Tobago
      "www.google.tt",
      "www.google.tt/webhp",
      // United Kingdom
      "www.google.co.uk",
      "www.google.co.uk/webhp",
      // United States
      "www.google.com",
      "www.google.com/webhp",
      // United States Virgin Islands
      "www.google.co.vi",
      "www.google.co.vi/webhp",
    ],
  ],
]);

// The maximum number of times we'll show a tip across all sessions.
const MAX_SHOWN_COUNT = 4;

// Amount of time to wait before showing a tip after selecting a tab or
// navigating to a page where we should show a tip.
const SHOW_TIP_DELAY_MS = 200;

// We won't show a tip if the browser has been updated in the past
// LAST_UPDATE_THRESHOLD_MS.
const LAST_UPDATE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Our browser.urlbar provider name.
const URLBAR_PROVIDER_NAME = "tips";

// Telemetry names.
const TELEMETRY_SCALARS_NAME = "urlbarTipsExperiment";
const TELEMETRY_SCALARS_SHOWN_COUNT_NAME = `${TELEMETRY_SCALARS_NAME}.tipShownCount`;

// We store in browser.storage.local the number of times we've shown a tip
// across all sessions.
const STORAGE_KEY_SHOWN_COUNT = "tipsShownCount";

// The current study branch.
let studyBranch;

// The tip we should currently show.
let currentTip = TIPS.NONE;

// Whether we've shown a tip in the current engagement.
let showedTipInCurrentEngagement = false;

// Whether we've shown a tip in the current session.
let showedTipInCurrentSession = false;

// Our copy of browser.storage.local.
let storage;

/**
 * browser.tabs.onTabActivated listener.  Checks to see whether we should show a
 * tip.
 */
function onTabActivated(info) {
  maybeShowTipForTab(info.tabId);
}

/**
 * browser.webNavigation.onCompleted listener.  Called when a page has finished
 * loading.  Checks to see whether we should show a tip.
 */
async function onWebNavigation(details) {
  // frameId == 0 for top-level loads.  We also exclude about:newtab because
  // sometimes when a new tab is opened, this function is called *while*
  // onTabActivated/maybeShowTipForTab are in the middle of running (but not
  // always), and that causes no tip or an incorrect tip to be shown (at least
  // during the test).  So we'll capture new tabs by onTabActivated only.
  if (details.frameId == 0 && details.url != "about:newtab") {
    let tab = await browser.tabs.get(details.tabId);
    if (tab.active) {
      maybeShowTipForTab(details.tabId);
    }
  }
}

/**
 * Determines whether we should show a tip for the current tab.  Sets currentTip
 * and calls browser.urlbar.search as appropriate.  Once this calls search, our
 * browser.urlbar.onBehaviorRequested and browser.urlbar.onResultsRequested
 * listeners take it from there.
 *
 * @param {number} tabID
 *   The ID of the current tab.
 */
async function maybeShowTipForTab(tabID) {
  let tab = await browser.tabs.get(tabID);

  // We show only one tip per session, so if we've shown one already, stop.
  if (showedTipInCurrentSession) {
    return;
  }

  // Get the number of times we've shown a tip over all sessions.  If it's the
  // max, don't show it again.
  if (!storage) {
    storage = await browser.storage.local.get(STORAGE_KEY_SHOWN_COUNT);
    if (!(STORAGE_KEY_SHOWN_COUNT in storage)) {
      storage[STORAGE_KEY_SHOWN_COUNT] = 0;
    }
  }
  if (storage[STORAGE_KEY_SHOWN_COUNT] >= MAX_SHOWN_COUNT) {
    return;
  }

  // Don't show a tip if the browser is already showing some other notification.
  if (await browser.experiments.urlbar.isBrowserShowingNotification()) {
    return;
  }

  // Don't show a tip if the browser has been updated recently.
  let date = await browser.experiments.urlbar.lastBrowserUpdateDate();
  if (Date.now() - date <= LAST_UPDATE_THRESHOLD_MS) {
    return;
  }

  // Determine which tip we should show for the tab.
  let tip;
  let isNewtab = ["about:newtab", "about:home"].includes(tab.url);
  let isSearchHomepage = !isNewtab && (await isDefaultEngineHomepage(tab.url));
  if (isNewtab) {
    tip = TIPS.ONBOARD;
  } else if (isSearchHomepage) {
    tip = TIPS.REDIRECT;
  } else {
    // No tip.
    return;
  }

  // At this point, we're showing a tip.

  showedTipInCurrentSession = true;

  // Store the new shown count.
  storage[STORAGE_KEY_SHOWN_COUNT]++;
  await browser.storage.local.set(storage);

  // Update shown-count telemetry.
  browser.telemetry.keyedScalarAdd(TELEMETRY_SCALARS_SHOWN_COUNT_NAME, tip, 1);

  if (studyBranch == BRANCHES.TREATMENT) {
    // Start a search.  Our browser.urlbar.onBehaviorRequested and
    // browser.urlbar.onResultsRequested listeners will be called.  We do this
    // on a timeout because sometimes urlbar.value will be set *after* our
    // search call (due to an onLocationChange), and we want it to remain empty.
    setTimeout(() => {
      currentTip = tip;
      browser.urlbar.search("", { focus: tip == TIPS.ONBOARD });
    }, SHOW_TIP_DELAY_MS);
  }
}

/**
 * browser.urlbar.onBehaviorRequested listener.
 */
async function onBehaviorRequested(query) {
  return currentTip ? "restricting" : "inactive";
}

/**
 * browser.urlbar.onResultsRequested listener.
 */
async function onResultsRequested(query) {
  let tip = currentTip;
  currentTip = TIPS.NONE;

  showedTipInCurrentEngagement = true;

  let engines = await browser.search.get();
  let defaultEngine = engines.find(engine => engine.isDefault);

  let result = {
    type: "tip",
    source: "local",
    payload: {
      icon: defaultEngine.favIconUrl,
      buttonText: "Okay, Got It",
    },
  };

  switch (tip) {
    case TIPS.ONBOARD:
      result.heuristic = true;
      result.payload.text =
        `Type less, find more: Search ${defaultEngine.name} ` +
        `right from your address bar.`;
      break;
    case TIPS.REDIRECT:
      result.heuristic = false;
      result.payload.text =
        `Start your search here to see suggestions from ` +
        `${defaultEngine.name} and your browsing history.`;
      break;
  }

  return [result];
}

/**
 * browser.urlbar.onResultPicked listener.  Called when a tip button is picked.
 */
async function onResultPicked(payload) {
  browser.urlbar.focus();

  // UrlbarInput calls handleRevert when the tip is picked, which puts the
  // current page's URL back into the input.  We want the input to be empty and
  // showing the magnifying class icon (pageproxystate=invalid), so call
  // clearInput now.
  browser.experiments.urlbar.clearInput();

  // onEngagement will be called too.
}

/**
 * browser.urlbar.onEngagement listener.  Called when an engagement starts and
 * stops.
 */
async function onEngagement(state) {
  if (showedTipInCurrentEngagement && state == "engagement") {
    // The user either clicked the tip's "Okay, Got It" button, or they made an
    // engagement with the urlbar while the tip was showing.  We treat both as
    // the user's acknowledgment of the tip, and we don't show tips again in any
    // session.  Set the shown count to the max.
    storage[STORAGE_KEY_SHOWN_COUNT] = MAX_SHOWN_COUNT;
    await browser.storage.local.set(storage);
    sendTestMessage("engaged");
  }
  showedTipInCurrentEngagement = false;
}

/**
 * browser.webNavigation.onBeforeNavigate listener.  Called when a new
 * navigation starts.  We use this to close the urlbar view, which is necessary
 * when the input isn't focused.
 */
async function onBeforeNavigate(details) {
  // frameId == 0 for top-level loads.
  if (details.frameId == 0) {
    let tab = await browser.tabs.get(details.tabId);
    if (tab.active) {
      browser.urlbar.closeView();
    }
  }
}

/**
 * browser.windows.onFocusChanged listener.  We use this to close the urlbar
 * view, which is necessary when the input isn't focused.
 */
function onWindowFocusChanged() {
  browser.urlbar.closeView();
}

/**
 * Resets all the state we set on enrollment in the study.
 */
async function unenroll() {
  await browser.experiments.urlbar.engagementTelemetry.clear({});
  await browser.tabs.onActivated.removeListener(onTabActivated);
  await browser.webNavigation.onCompleted.removeListener(onWebNavigation);
  await browser.urlbar.onBehaviorRequested.removeListener(onBehaviorRequested);
  await browser.urlbar.onResultsRequested.removeListener(onResultsRequested);
  await browser.urlbar.onResultPicked.removeListener(onResultPicked);
  await browser.urlbar.onEngagement.removeListener(onEngagement);
  await browser.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate);
  await browser.windows.onFocusChanged.removeListener(onWindowFocusChanged);
  sendTestMessage("unenrolled");
}

/**
 * Sets up all appropriate state for enrollment in the study.
 */
async function enroll() {
  await browser.normandyAddonStudy.onUnenroll.addListener(async () => {
    await unenroll();
  });

  // Listen for tab selection.
  await browser.tabs.onActivated.addListener(onTabActivated);

  // Listen for page loads.
  await browser.webNavigation.onCompleted.addListener(onWebNavigation);

  // Add urlbar listeners.
  await browser.urlbar.onBehaviorRequested.addListener(
    onBehaviorRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultsRequested.addListener(
    onResultsRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultPicked.addListener(
    onResultPicked,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onEngagement.addListener(
    onEngagement,
    URLBAR_PROVIDER_NAME
  );

  // When the urlbar is blurred, it automatically closes the view.  For the
  // redirect tip, we open the view without focusing the urlbar, which means
  // that it will remain open in more cases than usual.  The urlbar also closes
  // the view when the user clicks outside the view and when tabs are selected.
  // We need to handle when navigation happens (without a click) and when the
  // window focus changes.
  await browser.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
  await browser.windows.onFocusChanged.addListener(onWindowFocusChanged);

  // Enable urlbar engagement event telemetry.
  await browser.experiments.urlbar.engagementTelemetry.set({ value: true });

  // Register scalar telemetry.  We increment a keyed scalar when we show a tip.
  browser.telemetry.registerScalars(TELEMETRY_SCALARS_NAME, {
    tipShownCount: {
      kind: "count",
      keyed: true,
      record_on_release: true,
    },
  });

  sendTestMessage("enrolled");
}

/**
 * Checks if the given URL is the homepage of the current default search engine.
 * Returns false if the default engine is not listed in SUPPORTED_ENGINES.
 * @param {string} urlStr
 *   The URL to check, in string form.
 *
 * @returns {boolean}
 */
async function isDefaultEngineHomepage(urlStr) {
  let engines = await browser.search.get();
  let defaultEngine = engines.find(engine => engine.isDefault);
  if (!defaultEngine) {
    return false;
  }

  let homepages = SUPPORTED_ENGINES.get(defaultEngine.name);
  if (!homepages) {
    return false;
  }

  // The URL object throws if the string isn't a valid URL.
  let url;
  try {
    url = new URL(urlStr);
  } catch (e) {
    return false;
  }
  // Strip protocol, query parameters, and trailing slash.
  urlStr = url.hostname.concat(url.pathname);
  if (urlStr.endsWith("/")) {
    urlStr = urlStr.slice(0, -1);
  }

  return (
    homepages.includes(urlStr) &&
    // duckduckgo.com is a special case.  The home page and search results page
    // have the same URL except the search results page has a "q" search param.
    (urlStr != "duckduckgo.com" || !url.searchParams.has("q"))
  );
}

/**
 * Logs a debug message, which the test harness interprets as a message the
 * add-on is sending to the test.  See head.js for info.
 *
 * @param {string} msg
 *   The message.
 */
function sendTestMessage(msg) {
  console.debug(browser.runtime.id, msg);
}

(async function main() {
  // As a development convenience, act like we're enrolled in the treatment
  // branch if we're a temporary add-on.  onInstalled with details.temporary =
  // true will be fired in that case.  Add the listener now before awaiting the
  // study below to make sure we don't miss the event.
  let installPromise = new Promise(resolve => {
    browser.runtime.onInstalled.addListener(details => {
      resolve(details.temporary);
    });
  });

  // If we're enrolled in the study, set everything up, and then we're done.
  let study = await browser.normandyAddonStudy.getStudy();
  if (study) {
    // Sanity check the study.  This conditional should always be true.
    if (study.active && Object.values(BRANCHES).includes(study.branch)) {
      studyBranch = study.branch;
      await enroll();
    }
    sendTestMessage("ready");
    return;
  }

  // There's no study.  If installation happens, then continue with the
  // development convenience described above.
  installPromise.then(async isTemporaryInstall => {
    if (isTemporaryInstall) {
      console.debug("isTemporaryInstall");
      studyBranch = BRANCHES.TREATMENT;
      await enroll();
    }
    sendTestMessage("ready");
  });
})();
