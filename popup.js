const extButton = document.getElementById("ext-button");

function setButtonStyle(button, isPressed) {
  if (isPressed) {
    button.classList.remove("unpressed");
    button.classList.add("pressed");
  } else {
    button.classList.remove("pressed");
    button.classList.add("unpressed");
  }
}

chrome.storage.local.get({ isEnabled: false }, (data) => {
  setButtonStyle(extButton, data.isEnabled);
});


extButton.addEventListener("click", async () => {
  const { isEnabled } = await chrome.storage.local.get({ isEnabled: false });
  const newState = !isEnabled;

  await chrome.storage.local.set({ isEnabled: newState });
  setButtonStyle(extButton, newState);

  chrome.runtime.sendMessage({
    action: "toggleState",
    enabled: newState
  });
});