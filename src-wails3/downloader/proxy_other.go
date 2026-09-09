//go:build !windows

package downloader

import (
	neturl "net/url"
)

func (pm *ProxyManager) getSystemProxyOS(targetURL *neturl.URL) (*neturl.URL, error) {
	return nil, nil
}
