$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$root = if ($env:WORK_FIXTURE_ROOT) { $env:WORK_FIXTURE_ROOT } else { (Resolve-Path "$PSScriptRoot\..\..\..").Path }
$out = Join-Path $root '.pi\work-artifacts\desktop-smoke'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$form = New-Object Windows.Forms.Form
$form.Text = 'Capability Desktop Fixture'
$form.Size = New-Object Drawing.Size(420,240)
$label = New-Object Windows.Forms.Label
$label.Text = 'Ready'
$label.Location = New-Object Drawing.Point(30,30)
$button = New-Object Windows.Forms.Button
$button.Text = 'Activate'
$button.Location = New-Object Drawing.Point(30,80)
$button.Add_Click({ $label.Text = 'Activated' })
$form.Controls.AddRange(@($label,$button))
$form.Show()
[Windows.Forms.Application]::DoEvents()
$button.PerformClick()
[Windows.Forms.Application]::DoEvents()
if ($label.Text -ne 'Activated') { throw 'desktop interaction failed' }
$bitmap = New-Object Drawing.Bitmap($form.Width,$form.Height)
$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
$screenshot = Join-Path $out 'desktop.png'
$bitmap.Save($screenshot,[Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose(); $form.Dispose()
$log = Join-Path $out 'desktop.log'
"platform=$([Environment]::OSVersion.VersionString)`nwindow=Capability Desktop Fixture`ninteraction=Activated`ncleanup=disposed" | Set-Content $log
@{ artifacts = @{ screenshot = '.pi/work-artifacts/desktop-smoke/desktop.png'; log = '.pi/work-artifacts/desktop-smoke/desktop.log' }; cleanup = @{ ok = $true; window = 'disposed' }; state = 'Activated'; executable = 'System.Windows.Forms' } | ConvertTo-Json -Compress
