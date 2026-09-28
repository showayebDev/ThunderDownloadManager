//go:build !windows

package proxy

import (
	neturl "net/url"
)

func (pm *ProxyManager) getSystemProxyOS(targetURL *neturl.URL) (*neturl.URL, error) {
	return nil, nil
}
