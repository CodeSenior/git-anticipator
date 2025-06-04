import * as vscode from 'vscode';
import * as dns from 'dns';
import { promisify } from 'util';

let isOnline = true;
let lastConnectivityWarning = 0;
let connectivityCheckInterval: NodeJS.Timeout | null = null;

// Check internet connectivity
async function checkInternetConnectivity(): Promise<boolean> {
  try {
    // Test DNS resolution to check connectivity
    const dnsLookup = promisify(dns.lookup);
    await dnsLookup('github.com');
    return true;
  } catch (error) {
    console.log('Internet connectivity check failed:', error);
    return false;
  }
}

// Show a warning message for connectivity
function showConnectivityWarning(isConnected: boolean) {
  const now = Date.now();
  // Avoid spamming messages (maximum one every 30 seconds)
  if (now - lastConnectivityWarning < 30000) {
    return;
  }
  
  lastConnectivityWarning = now;
  
  if (!isConnected && isOnline) {
    // Connection lost
    vscode.window.showWarningMessage(
      '⚠️ Internet connection interrupted - Git operations with remote branches may fail',
      'Retry',
      'Ignore'
    ).then(selection => {
      if (selection === 'Retry') {
        checkConnectivityAndUpdate();
      }
    });
    isOnline = false;
  } else if (isConnected && !isOnline) {
    // Connection restored
    vscode.window.showInformationMessage('✅ Internet connection restored');
    isOnline = true;
  }
}

// Check and update connectivity status
async function checkConnectivityAndUpdate() {
  const currentStatus = await checkInternetConnectivity();
  showConnectivityWarning(currentStatus);
}

// Start connectivity monitoring
function startConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
  }
  
  // Check connectivity every 30 seconds
  connectivityCheckInterval = setInterval(async () => {
    await checkConnectivityAndUpdate();
  }, 30000);
  
  // Initial check
  checkConnectivityAndUpdate();
}

// Stop connectivity monitoring
function stopConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
}

export default {
  startConnectivityMonitoring,
  stopConnectivityMonitoring,
  checkConnectivityAndUpdate
};
