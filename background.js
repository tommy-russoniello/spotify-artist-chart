chrome.webRequest.onSendHeaders.addListener(
  function(details) {
    if (!details.url.startsWith('https://api-partner.spotify.com/pathfinder/v1/query')) return;
    for (var i = 0; i < details.requestHeaders.length; ++i) {
      if (details.requestHeaders[i].name.toLowerCase() === 'authorization') {
        authToken = details.requestHeaders[i].value.match(/Bearer\ (.+)/)[1]
        if (authToken && typeof authToken !== 'undefined' && details.initiator.match(/.*:\/\/.*spotify.com.*/)) {
          chrome.storage.local.set({ auth: authToken}, function() {});
        }
      }
    }
  },
  {
    urls: ["<all_urls>"],
    types: ["xmlhttprequest"]
  },
  ['requestHeaders']
);

chrome.action.onClicked.addListener(function (tab) {
  artist = tab.url.match(/https:\/\/open.spotify.com\/artist\/(.+)/)[1]
  chrome.storage.local.set({ artist: artist}, function() {
    chrome.tabs.create({
      url: 'index.html',
      selected: true,
    })
  });
})

// Wrap in an onInstalled callback in order to avoid unnecessary work
// every time the background script is run
chrome.runtime.onInstalled.addListener(() => {
  // Page actions are disabled by default and enabled on select tabs
  chrome.action.disable();

  // Clear all rules to ensure only our expected rules are set
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    // Declare a rule to enable the action on example.com pages
    let exampleRule = {
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: { hostSuffix: '.spotify.com'},
        })
      ],
      actions: [new chrome.declarativeContent.ShowAction()],
    };

    // Finally, apply our new array of rules
    let rules = [exampleRule];
    chrome.declarativeContent.onPageChanged.addRules(rules);
  });
});
