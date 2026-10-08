let storageWindowId = null;

async function getStorageWindow() {
  if (storageWindowId !== null) {
    try {
      const win = await chrome.windows.get(storageWindowId);
      if (win) return storageWindowId;
    } catch (e) {
      storageWindowId = null;
    }
  }

  const data = await chrome.storage.local.get("storageWindowId");
  if (data.storageWindowId) {
    try {
      const win = await chrome.windows.get(data.storageWindowId);
      if (win) {
        storageWindowId = data.storageWindowId;
        return storageWindowId;
      }
    } catch (e) {}
  }

  return null;
}

async function moveTabsWithGroups(tabs, targetWindowId, isRestoring = false) {
  if (tabs.length === 0) return;

  const { tabIndices = {} } = await chrome.storage.local.get("tabIndices");

  if (!isRestoring) {
    for (const tab of tabs) {
      tabIndices[tab.id] = tab.index;
    }
    await chrome.storage.local.set({ tabIndices });
  }

  const groupedTabs = {};
  const ungroupedTabs = [];

  for (const tab of tabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      if (!groupedTabs[tab.groupId]) {
        groupedTabs[tab.groupId] = [];
      }
      groupedTabs[tab.groupId].push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  if (ungroupedTabs.length > 0) {
    const ids = ungroupedTabs.map(t => t.id);
    await chrome.tabs.move(ids, { windowId: targetWindowId, index: 0 });
  }


  for (const [sourceGroupId, groupTabs] of Object.entries(groupedTabs)) {

    const groupInfo = await chrome.tabGroups.get(parseInt(sourceGroupId));

    const firstTab = groupTabs[0];
    const targetIndex = isRestoring && tabIndices[firstTab.id] !== undefined ? tabIndices[firstTab.id] : -1;


    const tabIds = groupTabs.map(t => t.id);


    const movedTabs = await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: 0 });

    const movedTabIds = Array.isArray(movedTabs) ? movedTabs.map(t => t.id) : [movedTabs.id];
    const newGroupId = await chrome.tabs.group({
      tabIds: movedTabIds,
      createProperties: { windowId: targetWindowId }
    });

    await chrome.tabGroups.update(newGroupId, {
      title: groupInfo.title,
      color: groupInfo.color,
      collapsed: !isRestoring
    });
  }
}

async function isolateActiveGroup(activeTab) {
  const activeGroupId = activeTab.groupId;
  const activeTabId = activeTab.id;
  const currentWindowId = activeTab.windowId;

  if (storageWindowId && currentWindowId === storageWindowId) return;

  let storageId = await getStorageWindow();

  if (activeGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && storageId) {
    const storedGroupTabs = await chrome.tabs.query({ windowId: storageId, groupId: activeGroupId });
    if (storedGroupTabs.length > 0) {
      await moveTabsWithGroups(storedGroupTabs, currentWindowId, true);
    }
  }

  const allTabsInCurrentWindow = await chrome.tabs.query({ windowId: currentWindowId });

  const tabsToHide = allTabsInCurrentWindow.filter(tab => {
    if (activeGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return tab.groupId !== activeGroupId;
    }
    return tab.id !== activeTabId;
  });

  if (tabsToHide.length === 0) return;

  if (!storageId) {
    const firstTabToHide = tabsToHide[0];
    const newWin = await chrome.windows.create({
      tabId: firstTabToHide.id,
      focused: false,
      state: "minimized"
    });
    storageWindowId = newWin.id;
    await chrome.storage.local.set({ storageWindowId });

    const remainingTabs = tabsToHide.slice(1);
    if (remainingTabs.length > 0) {
      await moveTabsWithGroups(remainingTabs, storageWindowId);
    }
  } else {
    await moveTabsWithGroups(tabsToHide, storageId);
  }
}


async function restoreAllTabs() {
  const storageId = await getStorageWindow();
  if (!storageId) return;

  const storedTabs = await chrome.tabs.query({ windowId: storageId });

  if (storedTabs.length > 0) {
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const targetWindowId = lastFocusedWindow.id;
    await moveTabsWithGroups(storedTabs, targetWindowId, true);
  }

  try {
    await chrome.windows.remove(storageId);
  } catch (e) {}
  
  storageWindowId = null;
  await chrome.storage.local.remove(["storageWindowId", "tabIndices"]);
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { isEnabled } = await chrome.storage.local.get({ isEnabled: false });
  if (!isEnabled) return;

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await isolateActiveGroup(tab);
  } catch (err) {
    console.error("Ошибка изоляции вкладок:", err);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "toggleState") {
    if (message.enabled) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) isolateActiveGroup(tabs[0]);
      });
    } else {
      restoreAllTabs();
    }
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === storageWindowId) {
    storageWindowId = null;
    chrome.storage.local.remove("storageWindowId");
  }
});