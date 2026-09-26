//go:build !windows

package fonts

// GetSystemFonts returns standard English fonts on non-Windows platforms.
func GetSystemFonts() ([]string, error) {
	return []string{
		"Default",
		"Arial",
		"Calibri",
		"Cascadia Code",
		"Consolas",
		"Courier New",
		"Fira Code",
		"Georgia",
		"Helvetica",
		"Helvetica Neue",
		"Impact",
		"Inter",
		"Lucida Grande",
		"Menlo",
		"Monaco",
		"Roboto",
		"San Francisco",
		"Segoe UI",
		"Tahoma",
		"Times New Roman",
		"Trebuchet MS",
		"Ubuntu",
		"Verdana",
	}, nil
}
