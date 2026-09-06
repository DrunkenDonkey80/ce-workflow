# ce-ui-gate Windows UIA fixture dump (plan-final.md 2.7 P4).
# Shows a fixed-layout WinForms fixture, pumps events, walks its own UIA
# tree, prints one JSON payload, closes. Zero dependencies beyond the OS.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ce-ui-gate fixture'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(60, 60)
$form.Size = New-Object System.Drawing.Size(360, 200)
$form.FormBorderStyle = 'FixedDialog'

$a = New-Object System.Windows.Forms.Button
$a.Text = 'Alpha'
$a.Location = New-Object System.Drawing.Point(20, 30)
$a.Size = New-Object System.Drawing.Size(100, 40)

$b = New-Object System.Windows.Forms.Button
$b.Text = 'Beta'
$b.Location = New-Object System.Drawing.Point(220, 30)
$b.Size = New-Object System.Drawing.Size(100, 40)

$form.Controls.AddRange(@($a, $b))
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 400
[System.Windows.Forms.Application]::DoEvents()

$root = [System.Windows.Automation.AutomationElement]::FromHandle($form.Handle)
$elements = New-Object System.Collections.ArrayList

function Walk($el, $depth) {
    if ($depth -gt 8) { return }
    $r = $el.Current.BoundingRectangle
    $invoke = $false
    foreach ($p in $el.GetSupportedPatterns()) {
        if ($p.ProgrammaticName -like '*InvokePattern*') { $invoke = $true }
    }
    $entry = [ordered]@{
        tag = [string]$el.Current.ControlType.ProgrammaticName
        name = [string]$el.Current.Name
        focusable = [bool]$el.Current.IsKeyboardFocusable
        invoke = [bool]$invoke
        rect = @{
            x = [int]$r.X
            y = [int]$r.Y
            width = [int]$r.Width
            height = [int]$r.Height
        }
    }
    [void]$elements.Add($entry)
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $node = $walker.GetFirstChild($el)
    while ($node -ne $null) {
        Walk $node ($depth + 1)
        $node = $walker.GetNextSibling($node)
    }
}

Walk $root 0
$form.Close()
$elements | ConvertTo-Json -Depth 4 -Compress
