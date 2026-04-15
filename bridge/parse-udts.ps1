param([string]$udtDir, [string]$outputJson)

$results = @{}
Get-ChildItem -Path $udtDir -Filter 'udtHMI_*.xml' | ForEach-Object {
    $xml = [xml](Get-Content $_.FullName -Raw)

    # Namespace for interface section
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('i', 'http://www.siemens.com/automation/Openness/SW/Interface/v5')

    $structNode = $xml.SelectSingleNode('//SW.Types.PlcStruct')
    $nameNode = $structNode.AttributeList.Name
    $udtName = $nameNode

    $members = @()
    $memberNodes = $structNode.SelectNodes('.//i:Section/i:Member', $ns)
    foreach ($m in $memberNodes) {
        $memberName = $m.Attributes['Name'].Value
        $dataType = $m.Attributes['Datatype'].Value

        # Read ExternalWritable attribute
        $writable = $false
        $attrNodes = $m.SelectNodes('.//i:BooleanAttribute', $ns)
        foreach ($a in $attrNodes) {
            if ($a.Attributes['Name'].Value -eq 'ExternalWritable') {
                $writable = ($a.InnerText -eq 'true')
                break
            }
        }

        # Read English comment
        $comment = ''
        $commentNode = $m.SelectSingleNode('.//i:Comment/i:MultiLanguageText', $ns)
        if ($commentNode) { $comment = $commentNode.InnerText }

        $members += [pscustomobject]@{
            name = $memberName
            dataType = $dataType
            hmiWritable = $writable
            comment = $comment
        }
    }

    $results[$udtName] = $members
    Write-Host "Parsed $udtName : $($members.Count) members"
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $outputJson
Write-Host ""
Write-Host "Wrote $($results.Keys.Count) UDTs to $outputJson"
