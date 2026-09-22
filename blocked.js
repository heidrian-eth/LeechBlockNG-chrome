/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

var gBlockedURL;
var gBlockedSet;

// Processes info for blocking page
//
function processBlockInfo(info) {
	if (!info) return;

	gBlockedURL = info.blockedURL;
	gBlockedSet = info.blockedSet;

	// Set theme
	let themeLink = document.getElementById("themeLink");
	if (themeLink) {
		themeLink.href = "/themes/" + (info.theme ? `${info.theme}.css` : "default.css");
	}

	// Set custom style
	let customStyle = document.getElementById("customStyle");
	if (customStyle) {
		customStyle.innerText = info.customStyle;
	}

	let blockedURL = document.getElementById("lbBlockedURL");
	if (info.blockedURL && blockedURL) {
		if (info.blockedURL.length > 60) {
			blockedURL.innerText = info.blockedURL.substring(0, 57) + "...";
		} else {
			blockedURL.innerText = info.blockedURL;
		}
	}

	let blockedURLLink = document.getElementById("lbBlockedURLLink");
	if (info.blockedURL && blockedURLLink && !info.disableLink) {
		blockedURLLink.setAttribute("href", info.blockedURL);
	}

	let blockedSet = document.getElementById("lbBlockedSet");
	if (info.blockedSet && blockedSet) {
		if (info.blockedSetName) {
			blockedSet.innerText = info.blockedSetName;
		} else {
			blockedSet.innerText += " " + info.blockedSet;
		}
		document.title += " (" + blockedSet.innerText + ")";
	}

	let keywordMatched = document.getElementById("lbKeywordMatched");
	let keywordMatch = document.getElementById("lbKeywordMatch");
	if (keywordMatched && keywordMatch) {
		if (info.keywordMatch) {
			keywordMatch.innerText = info.keywordMatch;
			keywordMatched.style.display = "";
		} else {
			keywordMatched.style.display = "none";
		}
	}

	let passwordInput = document.getElementById("lbPasswordInput");
	let passwordSubmit = document.getElementById("lbPasswordSubmit");
	if (passwordInput && passwordSubmit) {
		// No password configured means no password can ever be accepted
		let enabled = (info.passwordRequired !== false);
		passwordInput.disabled = !enabled;
		passwordSubmit.disabled = !enabled;
		if (enabled) {
			passwordInput.focus();
			passwordSubmit.onclick = onSubmitPassword;
		}
	}

	let customMsgDiv = document.getElementById("lbCustomMsgDiv");
	let customMsg = document.getElementById("lbCustomMsg");
	if (customMsgDiv && customMsg) {
		if (info.customMsg) {
			customMsg.innerText = info.customMsg;
			customMsgDiv.style.display = "";
		} else {
			customMsgDiv.style.display = "none";
		}
	}

	let unblockTime = document.getElementById("lbUnblockTime");
	if (info.unblockTime && unblockTime) {
		unblockTime.innerText = info.unblockTime;
	}

	let delaySecs = document.getElementById("lbDelaySeconds");
	if (info.delaySecs && delaySecs) {
		delaySecs.innerText = info.delaySecs;

		// Start countdown timer
		let countdown = {
			delaySecs: info.delaySecs,
			delayCancel: info.delayCancel
		};
		countdown.interval = window.setInterval(onCountdownTimer, 1000, countdown);
	}

	if (info.reloadSecs) {
		// Reload blocked page after specified time
		window.setTimeout(reloadBlockedPage, info.reloadSecs * 1000);
	}
}

// Handle countdown on delaying page
//
function onCountdownTimer(countdown) {
	// Cancel countdown if document not focused
	if (countdown.delayCancel && !document.hasFocus()) {
		// Clear countdown timer
		window.clearInterval(countdown.interval);

		// Strike through countdown text
		let countdownText = document.getElementById("lbCountdownText");
		if (countdownText) {
			countdownText.style.textDecoration = "line-through";
		}

		return;
	}

	countdown.delaySecs--;

	// Update countdown seconds on page
	let delaySecs = document.getElementById("lbDelaySeconds");
	if (delaySecs) {
		delaySecs.innerText = countdown.delaySecs;
	}

	if (countdown.delaySecs == 0) {
		// Clear countdown timer
		window.clearInterval(countdown.interval);

		// Notify extension that delay countdown has completed
		let message = {
			type: "delayed",
			blockedURL: gBlockedURL,
			blockedSet: gBlockedSet
		};
		browser.runtime.sendMessage(message);
	}
}

// Handle submit button on password page
//
function onSubmitPassword() {
	let passwordInput = document.getElementById("lbPasswordInput");

	// Ask extension to check password (it is never held by this page)
	let message = {
		type: "password",
		password: passwordInput.value,
		blockedURL: gBlockedURL,
		blockedSet: gBlockedSet
	};
	browser.runtime.sendMessage(message).then(onCheckedPassword, function (error) {});

	function onCheckedPassword(response) {
		if (response && response.allowed) {
			return; // extension will load the blocked page
		}

		// Clear input field and flash background
		passwordInput.value = "";
		passwordInput.classList.add("error");
		window.setTimeout(() => { passwordInput.classList.remove("error"); }, 400);
	}
}

// Attempt to reload blocked page
//
function reloadBlockedPage() {
	if (gBlockedURL) {
		document.location.href = gBlockedURL;
	}
}

// Request block info from extension
//
// Right after a service worker restart the extension has not loaded its
// options yet and refuses to answer, so retry before giving up on the page.
function requestBlockInfo(attempt) {
	browser.runtime.sendMessage({ type: "blocked" }).then(onGot, onError);

	function onGot(info) {
		if (info) {
			processBlockInfo(info);
		} else {
			retry();
		}
	}

	function onError(error) {
		retry();
	}

	function retry() {
		if (attempt < 10) {
			window.setTimeout(requestBlockInfo, 500, attempt + 1);
		}
	}
}

requestBlockInfo(0);
