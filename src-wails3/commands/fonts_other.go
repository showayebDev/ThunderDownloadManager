//go:build !windows

package commands

func getSystemFontsOS() []string {
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
	}
}
