using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using Siemens.Engineering;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;

namespace PacForgeBridge
{
    /// <summary>
    /// Pac-Audit Step 0 — Openness API discovery spike.
    /// Reflection-heavy probes to answer:
    ///   * what shape does the cross-reference provider return?
    ///   * can we access Sinamics drive parameters via Openness?
    ///   * where is the GSDML / IODD cache on this box?
    ///   * does _project expose HmiTargets / a modified-date timestamp?
    ///   * rough timing for per-block vs per-project enumeration
    ///
    /// Writes per-probe JSON dumps to %TEMP%\PacForge\audit_spike_&lt;stamp&gt;\.
    /// Every probe is independent; one failure never aborts the rest.
    /// </summary>
    public partial class TiaPortalService
    {
        public AuditSpikeResponse RunAuditSpike()
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            string outDir = Path.Combine(Path.GetTempPath(), "PacForge", "audit_spike_" + stamp);
            Directory.CreateDirectory(outDir);

            string tiaVersion = null;
            try { tiaVersion = DetectInstalledVersion(); } catch { }

            var resp = new AuditSpikeResponse
            {
                Success = true,
                OutputDirectory = outDir,
                RunAt = DateTime.Now.ToString("o"),
                TiaVersion = tiaVersion,
                ProjectName = _project.Name,
            };

            RunProbe(resp, "project", "metadata_reflection", outDir, Probe_ProjectMetadata);
            RunProbe(resp, "cross_references", "assembly_type_discovery", outDir, Probe_AssemblyCrossRefTypes);
            RunProbe(resp, "cross_references", "block_reflection_and_services", outDir, Probe_BlockCrossRefDiscovery);
            RunProbe(resp, "blocks", "per_language_samples", outDir, Probe_PerLanguageBlockSamples);
            RunProbe(resp, "blocks", "interface_access", outDir, Probe_BlockInterfaceAccess);
            RunProbe(resp, "blocks", "enumeration_timing", outDir, Probe_BlockEnumerationTiming);
            RunProbe(resp, "hardware", "device_reflection", outDir, Probe_HardwareReflection);
            RunProbe(resp, "hardware", "drive_parameter_probe", outDir, Probe_DriveParameterAccess);
            RunProbe(resp, "hmi", "targets_walk", outDir, Probe_HmiTargets);
            RunProbe(resp, "gsdml", "cache_paths", outDir, Probe_GsdmlCache);

            // ── V2 probes: invoke the APIs V1 only mapped ──
            RunProbe(resp, "cross_references_v2", "service_acquisition", outDir, Probe_CrossRefServiceAcquisition);
            RunProbe(resp, "cross_references_v2", "method_signatures", outDir, Probe_CrossRefMethodSignatures);
            RunProbe(resp, "cross_references_v2", "sample_enumeration", outDir, Probe_CrossRefSampleEnumeration);
            RunProbe(resp, "hardware_v2", "drive_data_provider", outDir, Probe_DriveDataProvider);
            RunProbe(resp, "hardware_v2", "drive_child_type_scan", outDir, Probe_DriveChildTypeScan);

            File.WriteAllText(Path.Combine(outDir, "_summary.json"), Json.Serialize(resp));
            resp.Message = $"Spike complete — {resp.Findings.Count} probes, output at {outDir}";
            return resp;
        }

        private delegate ProbeResult ProbeFn(string outDir);

        private struct ProbeResult
        {
            public object Data;
            public int? ItemCount;
            public string Notes;
        }

        private void RunProbe(AuditSpikeResponse resp, string category, string name, string outDir, ProbeFn probe)
        {
            var sw = Stopwatch.StartNew();
            var finding = new SpikeFinding { Category = category, Name = name };
            try
            {
                ProbeResult pr = probe(outDir);
                string fileName = $"{category}__{name}.json";
                string filePath = Path.Combine(outDir, fileName);
                File.WriteAllText(filePath, Json.Serialize(pr.Data ?? new { }));
                finding.Success = true;
                finding.ItemCount = pr.ItemCount;
                finding.SampleFile = fileName;
                finding.Notes = pr.Notes;
            }
            catch (Exception ex)
            {
                finding.Success = false;
                finding.Notes = $"{ex.GetType().Name}: {ex.Message}";
                try
                {
                    File.WriteAllText(
                        Path.Combine(outDir, $"{category}__{name}__ERROR.json"),
                        Json.Serialize(new { error_type = ex.GetType().FullName, message = ex.Message, stack = ex.StackTrace }));
                }
                catch { }
            }
            finally
            {
                finding.ElapsedMs = sw.Elapsed.TotalMilliseconds;
                resp.Findings.Add(finding);
                Console.WriteLine($"[AuditSpike] {(finding.Success ? "OK " : "FAIL")} {category}/{name} ({finding.ElapsedMs:F0}ms) {finding.Notes}");
            }
        }

        // ── Probes ─────────────────────────────────────────────────────────

        private ProbeResult Probe_ProjectMetadata(string outDir)
        {
            var data = new Dictionary<string, object>
            {
                ["project_type"] = _project.GetType().FullName,
                ["project_assembly"] = _project.GetType().Assembly.FullName,
                ["all_public_properties"] = SafeReflectAllProps(_project, maxDepth: 1),
            };

            // Common candidate names for a modified-at timestamp — try each
            string[] candidates = { "ModifiedDate", "LastModifiedAt", "LastModified", "ChangedAt", "ModificationDate" };
            var attempted = new List<object>();
            foreach (var propName in candidates)
            {
                try
                {
                    var pi = _project.GetType().GetProperty(propName);
                    if (pi == null) { attempted.Add(new { prop = propName, status = "not_found" }); continue; }
                    var val = pi.GetValue(_project);
                    attempted.Add(new { prop = propName, status = "ok", type = pi.PropertyType.FullName, value = val?.ToString() });
                }
                catch (Exception ex)
                {
                    attempted.Add(new { prop = propName, status = "threw", error = ex.InnerException?.Message ?? ex.Message });
                }
            }
            data["modified_date_candidates"] = attempted;

            // Reflect on Project Attributes service
            try
            {
                var attrs = new List<object>();
                var getAttrMethod = _project.GetType().GetMethod("GetAttributes", new[] { typeof(IList<string>) });
                if (getAttrMethod != null)
                {
                    attrs.Add(new { method_present = true });
                }
                data["attribute_methods_on_project"] = _project.GetType()
                    .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                    .Where(m => m.Name.StartsWith("GetAttribute") || m.Name.StartsWith("SetAttribute"))
                    .Select(m => $"{m.Name}({string.Join(",", m.GetParameters().Select(p => p.ParameterType.Name))})")
                    .Distinct()
                    .ToList();
            }
            catch (Exception ex) { data["attribute_reflection_error"] = ex.Message; }

            return new ProbeResult { Data = data, Notes = $"attempted {candidates.Length} modified-date candidates" };
        }

        private ProbeResult Probe_AssemblyCrossRefTypes(string outDir)
        {
            var engAsm = typeof(Siemens.Engineering.Project).Assembly;
            var allTypes = SafeLoadTypes(engAsm);

            var xrefTypes = allTypes
                .Where(t => t != null && (
                    (t.Namespace != null && t.Namespace.IndexOf("CrossReference", StringComparison.OrdinalIgnoreCase) >= 0) ||
                    t.Name.IndexOf("CrossReference", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    t.Name.IndexOf("ReferenceObject", StringComparison.OrdinalIgnoreCase) >= 0))
                .OrderBy(t => t.FullName)
                .ToList();

            // Drop full shape of each matching type
            var rendered = xrefTypes.Select(t => new
            {
                full_name = t.FullName,
                is_interface = t.IsInterface,
                is_abstract = t.IsAbstract,
                namespace_name = t.Namespace,
                base_type = t.BaseType?.FullName,
                members = t.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                           .Select(m => $"{m.MemberType} {m.Name}").Distinct().ToList(),
            }).ToList();

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["engineering_assembly"] = engAsm.FullName,
                    ["matching_type_count"] = xrefTypes.Count,
                    ["types"] = rendered,
                    ["namespaces_with_reference_in_name"] = allTypes
                        .Where(t => t?.Namespace != null && t.Namespace.IndexOf("Reference", StringComparison.OrdinalIgnoreCase) >= 0)
                        .Select(t => t.Namespace)
                        .Distinct()
                        .OrderBy(n => n)
                        .ToList(),
                },
                ItemCount = xrefTypes.Count,
                Notes = $"{xrefTypes.Count} types contain CrossReference/ReferenceObject in name",
            };
        }

        private ProbeResult Probe_BlockCrossRefDiscovery(string outDir)
        {
            PlcSoftware plc = GetPlcSoftware();
            PlcBlock sampleFb = FindFirstBlockMatching(plc.BlockGroup, b => b is FB);
            if (sampleFb == null)
                return new ProbeResult { Data = new { warning = "no FB found in project" }, Notes = "no FB found" };

            var data = new Dictionary<string, object>
            {
                ["sample_block"] = new { name = sampleFb.Name, type = sampleFb.GetType().FullName },
                ["members_matching_reference_pattern"] = CollectMembers(sampleFb.GetType(),
                    m => m.Name.IndexOf("Reference", StringComparison.OrdinalIgnoreCase) >= 0
                      || m.Name.IndexOf("CrossRef", StringComparison.OrdinalIgnoreCase) >= 0
                      || m.Name.IndexOf("Usage", StringComparison.OrdinalIgnoreCase) >= 0),
                ["interfaces_implemented"] = sampleFb.GetType().GetInterfaces().Select(i => i.FullName).OrderBy(n => n).ToList(),
            };

            // Try GetService<T> for every interface in Siemens.Engineering.* whose name
            // mentions Reference / CrossRef / Provider — capture what returns non-null.
            var engAsm = typeof(Siemens.Engineering.Project).Assembly;
            var allTypes = SafeLoadTypes(engAsm);
            var candidates = allTypes
                .Where(t => t != null && t.IsInterface)
                .Where(t => t.Name.IndexOf("Reference", StringComparison.OrdinalIgnoreCase) >= 0
                         || t.Name.IndexOf("CrossRef", StringComparison.OrdinalIgnoreCase) >= 0
                         || t.Name.IndexOf("Provider", StringComparison.OrdinalIgnoreCase) >= 0)
                .Where(t => !t.IsGenericType)
                .OrderBy(t => t.FullName)
                .ToList();

            MethodInfo getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods()
                .FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);

            var probeResults = new List<object>();
            if (getServiceGeneric != null)
            {
                foreach (Type candidate in candidates)
                {
                    try
                    {
                        var gm = getServiceGeneric.MakeGenericMethod(candidate);

                        // Try on the block, on the PlcSoftware, and on the project
                        object onBlock = SafeInvoke(() => gm.Invoke(sampleFb, null));
                        object onPlcSw = SafeInvoke(() => gm.Invoke(plc, null));
                        object onProject = SafeInvoke(() => gm.Invoke(_project, null));

                        if (onBlock != null || onPlcSw != null || onProject != null)
                        {
                            probeResults.Add(new
                            {
                                service_interface = candidate.FullName,
                                on_block = onBlock?.GetType().FullName,
                                on_plc_software = onPlcSw?.GetType().FullName,
                                on_project = onProject?.GetType().FullName,
                                service_members = candidate.GetMembers(BindingFlags.Public | BindingFlags.Instance)
                                                           .Select(m => $"{m.MemberType} {m.Name}")
                                                           .Distinct()
                                                           .ToList(),
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        probeResults.Add(new { service_interface = candidate.FullName, error = ex.InnerException?.Message ?? ex.Message });
                    }
                }
            }
            else
            {
                data["get_service_generic_missing"] = true;
            }
            data["candidate_service_count"] = candidates.Count;
            data["non_null_service_probes"] = probeResults;

            return new ProbeResult
            {
                Data = data,
                ItemCount = probeResults.Count,
                Notes = $"{probeResults.Count} non-null services out of {candidates.Count} candidates",
            };
        }

        private ProbeResult Probe_PerLanguageBlockSamples(string outDir)
        {
            PlcSoftware plc = GetPlcSoftware();
            var allBlocks = new List<PlcBlock>();
            CollectBlocks(plc.BlockGroup, allBlocks);

            var byLang = allBlocks
                .GroupBy(b => { try { return b.ProgrammingLanguage.ToString(); } catch { return "?"; } })
                .ToDictionary(g => g.Key, g => g.ToList());

            var samples = new List<object>();
            foreach (var kv in byLang)
            {
                var first = kv.Value.FirstOrDefault();
                if (first == null) continue;
                samples.Add(new
                {
                    language = kv.Key,
                    count_in_project = kv.Value.Count,
                    sample_name = first.Name,
                    sample_type = first.GetType().FullName,
                    sample_base_type = first.GetType().BaseType?.FullName,
                    sample_interfaces = first.GetType().GetInterfaces().Select(i => i.FullName).ToList(),
                    sample_block_type = first is OB ? "OB" : first is FB ? "FB" : first is FC ? "FC" : first is InstanceDB ? "InstanceDB" : first is GlobalDB ? "GlobalDB" : first.GetType().Name,
                });
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["total_blocks"] = allBlocks.Count,
                    ["languages"] = byLang.ToDictionary(g => g.Key, g => g.Value.Count),
                    ["samples"] = samples,
                },
                ItemCount = byLang.Count,
                Notes = $"{allBlocks.Count} blocks, {byLang.Count} distinct languages",
            };
        }

        private ProbeResult Probe_BlockInterfaceAccess(string outDir)
        {
            PlcSoftware plc = GetPlcSoftware();
            PlcBlock sampleFb = FindFirstBlockMatching(plc.BlockGroup, b => b is FB);
            if (sampleFb == null)
                return new ProbeResult { Data = new { warning = "no FB found" }, Notes = "no FB" };

            // Look for Interface/Body/Variables/Parameters accessors
            var members = CollectMembers(sampleFb.GetType(),
                m => m.Name.IndexOf("Interface", StringComparison.OrdinalIgnoreCase) >= 0
                  || m.Name.IndexOf("Parameter", StringComparison.OrdinalIgnoreCase) >= 0
                  || m.Name.IndexOf("Variable", StringComparison.OrdinalIgnoreCase) >= 0
                  || m.Name.IndexOf("Member", StringComparison.OrdinalIgnoreCase) >= 0
                  || m.Name.IndexOf("Body", StringComparison.OrdinalIgnoreCase) >= 0
                  || m.Name.IndexOf("Section", StringComparison.OrdinalIgnoreCase) >= 0);

            // Try GetAttribute on candidate names
            string[] attrCandidates = { "Interface", "ProgrammingLanguage", "Number", "Name", "BlockType", "HeaderVersion" };
            var attrResults = new List<object>();
            foreach (var attr in attrCandidates)
            {
                try
                {
                    var val = sampleFb.GetAttribute(attr);
                    attrResults.Add(new { attribute = attr, ok = true, type = val?.GetType().FullName, value = val?.ToString() });
                }
                catch (Exception ex)
                {
                    attrResults.Add(new { attribute = attr, ok = false, error = ex.InnerException?.Message ?? ex.Message });
                }
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["sample"] = new { name = sampleFb.Name, language = sampleFb.ProgrammingLanguage.ToString() },
                    ["interface_members"] = members,
                    ["attribute_probes"] = attrResults,
                },
                Notes = $"{members.Count} candidate members, {attrResults.Count(r => (bool)r.GetType().GetProperty("ok").GetValue(r))} attribute hits",
            };
        }

        private ProbeResult Probe_BlockEnumerationTiming(string outDir)
        {
            PlcSoftware plc = GetPlcSoftware();

            var sw = Stopwatch.StartNew();
            var all = new List<PlcBlock>();
            CollectBlocks(plc.BlockGroup, all);
            sw.Stop();
            double collectMs = sw.Elapsed.TotalMilliseconds;

            sw.Restart();
            int totalMembers = 0;
            foreach (var b in all)
            {
                try { totalMembers += b.GetType().GetMembers().Length; } catch { }
            }
            sw.Stop();
            double reflectMs = sw.Elapsed.TotalMilliseconds;

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["block_count"] = all.Count,
                    ["collect_blocks_ms"] = collectMs,
                    ["per_block_reflect_ms"] = reflectMs,
                    ["avg_per_block_ms"] = all.Count > 0 ? (collectMs / all.Count) : 0.0,
                },
                ItemCount = all.Count,
                Notes = $"{all.Count} blocks collected in {collectMs:F1}ms",
            };
        }

        private ProbeResult Probe_HardwareReflection(string outDir)
        {
            var devices = new List<object>();
            int sinamicsHits = 0;
            foreach (Device device in _project.Devices)
            {
                string typeId = null;
                try { typeId = device.TypeIdentifier; } catch { }

                var deviceData = new Dictionary<string, object>
                {
                    ["name"] = device.Name,
                    ["type_id"] = typeId,
                    ["properties"] = SafeReflectAllProps(device, maxDepth: 1),
                    ["device_items"] = WalkDeviceItems(device.DeviceItems, 0, ref sinamicsHits),
                };
                devices.Add(deviceData);
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["devices"] = devices,
                    ["sinamics_candidate_count"] = sinamicsHits,
                },
                ItemCount = devices.Count,
                Notes = $"{devices.Count} devices, {sinamicsHits} Sinamics-family candidates (order 6SL…)",
            };
        }

        private List<object> WalkDeviceItems(DeviceItemComposition items, int depth, ref int sinamicsHits)
        {
            var list = new List<object>();
            if (depth > 4) return list;  // safety on deep hierarchies
            foreach (DeviceItem item in items)
            {
                string typeId = null;
                try { typeId = item.TypeIdentifier; } catch { }

                bool isSinamics = typeId != null && (
                    typeId.IndexOf("6SL", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    typeId.IndexOf("SINAMICS", StringComparison.OrdinalIgnoreCase) >= 0);
                if (isSinamics) sinamicsHits++;

                var entry = new Dictionary<string, object>
                {
                    ["name"] = item.Name,
                    ["type_id"] = typeId,
                    ["is_sinamics_candidate"] = isSinamics,
                    ["properties"] = SafeReflectAllProps(item, maxDepth: 0),
                    ["services_returning_nonnull"] = ProbeCommonServices(item),
                    ["children"] = WalkDeviceItems(item.DeviceItems, depth + 1, ref sinamicsHits),
                };
                list.Add(entry);
            }
            return list;
        }

        private List<object> ProbeCommonServices(IEngineeringObject target)
        {
            // Hardcoded list — add to this as the spike uncovers more
            string[] serviceNames =
            {
                "Siemens.Engineering.HW.Features.SoftwareContainer",
                "Siemens.Engineering.HW.Features.NetworkInterface",
                "Siemens.Engineering.HW.Features.HwIdentifier",
                "Siemens.Engineering.HW.Features.DeviceItemAssociation",
            };
            var engAsm = typeof(Siemens.Engineering.Project).Assembly;
            var hits = new List<object>();
            var getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods()
                .FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);
            if (getServiceGeneric == null) return hits;

            foreach (var name in serviceNames)
            {
                var t = engAsm.GetType(name);
                if (t == null) { hits.Add(new { service = name, status = "type_not_found" }); continue; }
                try
                {
                    var gm = getServiceGeneric.MakeGenericMethod(t);
                    var result = gm.Invoke(target, null);
                    hits.Add(new { service = name, returned_null = result == null, returned_type = result?.GetType().FullName });
                }
                catch (Exception ex)
                {
                    hits.Add(new { service = name, error = ex.InnerException?.Message ?? ex.Message });
                }
            }
            return hits;
        }

        private ProbeResult Probe_DriveParameterAccess(string outDir)
        {
            // Find first Sinamics candidate
            DeviceItem drive = null;
            foreach (Device dev in _project.Devices)
            {
                drive = FindSinamicsIn(dev.DeviceItems);
                if (drive != null) break;
            }
            if (drive == null)
                return new ProbeResult { Data = new { warning = "no Sinamics device found" }, Notes = "no Sinamics" };

            var data = new Dictionary<string, object>
            {
                ["drive_name"] = drive.Name,
                ["drive_type_id"] = SafeCall(() => drive.TypeIdentifier),
                ["services_returning_nonnull"] = ProbeCommonServices(drive),
                ["drive_item_properties"] = SafeReflectAllProps(drive, maxDepth: 1),
            };

            // Try GetAttribute for common Sinamics parameter names — we don't know which
            // will work; dump all outcomes.
            string[] paramCandidates =
            {
                "P304", "P305", "P311", "P922", "P1120", "P1121", "P1135",
                "MotorRatedPower", "MotorRatedCurrent", "MotorRatedSpeed",
                "TelegramNumber", "IpAddress", "StationName", "Name"
            };
            var attrs = new List<object>();
            foreach (var p in paramCandidates)
            {
                try
                {
                    var val = drive.GetAttribute(p);
                    attrs.Add(new { param = p, ok = true, type = val?.GetType().FullName, value = val?.ToString() });
                }
                catch (Exception ex)
                {
                    attrs.Add(new { param = p, ok = false, error = ex.InnerException?.Message ?? ex.Message });
                }
            }
            data["attribute_probes"] = attrs;

            // Walk all children one level deep — drives often have Motor / Drive Data / Telegram sub-items
            var childSummary = new List<object>();
            foreach (DeviceItem child in drive.DeviceItems)
            {
                childSummary.Add(new
                {
                    name = child.Name,
                    type_id = SafeCall(() => child.TypeIdentifier),
                    child_item_count = SafeCall(() => (object)child.DeviceItems.Count),
                });
            }
            data["drive_children"] = childSummary;

            return new ProbeResult
            {
                Data = data,
                Notes = $"drive '{drive.Name}', {attrs.Count(a => (bool)a.GetType().GetProperty("ok").GetValue(a))} attr hits",
            };
        }

        private DeviceItem FindSinamicsIn(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                string typeId = null;
                try { typeId = item.TypeIdentifier; } catch { }
                if (typeId != null && (typeId.IndexOf("6SL", StringComparison.OrdinalIgnoreCase) >= 0
                                     || typeId.IndexOf("SINAMICS", StringComparison.OrdinalIgnoreCase) >= 0))
                    return item;

                var nested = FindSinamicsIn(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        private ProbeResult Probe_HmiTargets(string outDir)
        {
            var data = new Dictionary<string, object>();

            // Look for HmiTargets property on project
            var hmiTargetsProp = _project.GetType().GetProperty("HmiTargets");
            data["hmi_targets_property_present"] = hmiTargetsProp != null;
            data["hmi_targets_property_type"] = hmiTargetsProp?.PropertyType.FullName;

            var targets = new List<object>();
            if (hmiTargetsProp != null)
            {
                try
                {
                    var collection = hmiTargetsProp.GetValue(_project) as IEnumerable;
                    if (collection != null)
                    {
                        foreach (var t in collection)
                        {
                            targets.Add(new
                            {
                                type_full_name = t?.GetType().FullName,
                                name = SafeCall(() => t?.GetType().GetProperty("Name")?.GetValue(t)?.ToString()),
                                properties = SafeReflectAllProps(t, maxDepth: 0),
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    data["enumeration_error"] = ex.Message;
                }
            }
            data["targets"] = targets;

            // Fallback — existing HmiTarget discovery via device walk
            try
            {
                var existing = GetHmiTarget();
                data["legacy_hmi_target_found"] = existing != null;
                if (existing != null)
                {
                    data["legacy_hmi_target_type"] = existing.GetType().FullName;
                    data["legacy_hmi_target_props"] = SafeReflectAllProps(existing, maxDepth: 0);
                }
            }
            catch (Exception ex) { data["legacy_hmi_target_error"] = ex.Message; }

            return new ProbeResult
            {
                Data = data,
                ItemCount = targets.Count,
                Notes = $"HmiTargets property: {(hmiTargetsProp != null ? "present" : "absent")}, {targets.Count} targets",
            };
        }

        private ProbeResult Probe_GsdmlCache(string outDir)
        {
            string userAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            string projectDir = null;
            try { projectDir = Path.GetDirectoryName(_project.Path?.ToString()); } catch { }

            string[] searchRoots =
            {
                Path.Combine(userAppData, @"Siemens\Automation"),
                Path.Combine(programData, @"Siemens\Automation"),
                projectDir,
            };

            var results = new List<object>();
            int totalGsdml = 0, totalIodd = 0;
            foreach (var root in searchRoots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                try
                {
                    var gsdmlFiles = Directory.GetFiles(root, "GSDML-*.xml", SearchOption.AllDirectories);
                    var ioddFiles = Directory.GetFiles(root, "IODD*.xml", SearchOption.AllDirectories);
                    totalGsdml += gsdmlFiles.Length;
                    totalIodd += ioddFiles.Length;
                    results.Add(new
                    {
                        root,
                        gsdml_count = gsdmlFiles.Length,
                        iodd_count = ioddFiles.Length,
                        gsdml_sample = gsdmlFiles.Take(5).Select(p => p.Replace(root, "$")).ToList(),
                        iodd_sample = ioddFiles.Take(5).Select(p => p.Replace(root, "$")).ToList(),
                    });
                }
                catch (Exception ex)
                {
                    results.Add(new { root, error = ex.Message });
                }
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["project_directory"] = projectDir,
                    ["user_appdata"] = userAppData,
                    ["program_data"] = programData,
                    ["searched"] = results,
                    ["total_gsdml_files"] = totalGsdml,
                    ["total_iodd_files"] = totalIodd,
                },
                ItemCount = totalGsdml + totalIodd,
                Notes = $"{totalGsdml} GSDML + {totalIodd} IODD files across {results.Count} roots",
            };
        }

        // ── Helpers ────────────────────────────────────────────────────────

        private static PlcBlock FindFirstBlockMatching(PlcBlockSystemGroup group, Func<PlcBlock, bool> predicate)
        {
            foreach (PlcBlock b in group.Blocks)
            {
                if (predicate(b)) return b;
            }
            foreach (PlcBlockUserGroup sub in group.Groups)
            {
                var found = FindFirstInUserGroup(sub, predicate);
                if (found != null) return found;
            }
            return null;
        }

        private static PlcBlock FindFirstInUserGroup(PlcBlockUserGroup group, Func<PlcBlock, bool> predicate)
        {
            foreach (PlcBlock b in group.Blocks)
            {
                if (predicate(b)) return b;
            }
            foreach (PlcBlockUserGroup sub in group.Groups)
            {
                var found = FindFirstInUserGroup(sub, predicate);
                if (found != null) return found;
            }
            return null;
        }

        private static Type[] SafeLoadTypes(Assembly asm)
        {
            try { return asm.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { return ex.Types.Where(t => t != null).ToArray(); }
            catch { return new Type[0]; }
        }

        private static List<string> CollectMembers(Type type, Func<MemberInfo, bool> predicate)
        {
            var seen = new HashSet<string>();
            var t = type;
            while (t != null && t != typeof(object))
            {
                foreach (var m in t.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    if (predicate(m))
                    {
                        string sig = $"{m.MemberType} {t.Name}.{m.Name}";
                        if (m is MethodInfo mi)
                            sig += "(" + string.Join(",", mi.GetParameters().Select(p => p.ParameterType.Name)) + ")";
                        seen.Add(sig);
                    }
                }
                t = t.BaseType;
            }
            return seen.OrderBy(s => s).ToList();
        }

        private static Dictionary<string, object> SafeReflectAllProps(object obj, int maxDepth)
        {
            var dict = new Dictionary<string, object>();
            if (obj == null) return dict;
            var type = obj.GetType();
            dict["__type"] = type.FullName;
            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (prop.GetIndexParameters().Length > 0) continue;
                try
                {
                    var val = prop.GetValue(obj);
                    dict[prop.Name] = RenderValue(val, maxDepth);
                }
                catch (Exception ex)
                {
                    dict[prop.Name] = $"<err: {ex.InnerException?.Message ?? ex.Message}>";
                }
            }
            return dict;
        }

        private static object RenderValue(object val, int maxDepth)
        {
            if (val == null) return null;
            var t = val.GetType();
            if (val is string) return val;
            if (t.IsPrimitive || val is decimal || val is DateTime || val is Guid) return val;
            if (val is Enum) return val.ToString();
            if (val is IEnumerable en && !(val is string))
            {
                var list = new List<object>();
                int n = 0;
                foreach (var x in en)
                {
                    if (n++ >= 10) { list.Add("… truncated"); break; }
                    list.Add(maxDepth > 0 ? (object)SafeReflectAllProps(x, maxDepth - 1) : (x?.GetType().FullName ?? "null"));
                }
                return list;
            }
            if (maxDepth <= 0) return t.FullName;
            return SafeReflectAllProps(val, maxDepth - 1);
        }

        private static object SafeInvoke(Func<object> fn)
        {
            try { return fn(); } catch { return null; }
        }

        private static object SafeCall(Func<object> fn)
        {
            try { return fn(); } catch (Exception ex) { return $"<err: {ex.InnerException?.Message ?? ex.Message}>"; }
        }

        // ── V2 probes ──────────────────────────────────────────────────────

        private Type FindTypeByName(string fullName)
        {
            var engAsm = typeof(Siemens.Engineering.Project).Assembly;
            return engAsm.GetType(fullName);
        }

        private ProbeResult Probe_CrossRefServiceAcquisition(string outDir)
        {
            Type svcType = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceService");
            if (svcType == null)
                return new ProbeResult { Data = new { error = "CrossReferenceService type not found" }, Notes = "type missing" };

            PlcSoftware plc = GetPlcSoftware();
            PlcBlock firstFb = FindFirstBlockMatching(plc.BlockGroup, b => b is FB);

            // Try GetService<CrossReferenceService>() on every plausible parent
            MethodInfo getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods().FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);

            var tries = new List<object>();
            object[] parents =
            {
                new { label = "project", obj = (IEngineeringServiceProvider)_project },
                new { label = "plc_software", obj = (IEngineeringServiceProvider)plc },
                new { label = "plc_block_group", obj = (IEngineeringServiceProvider)plc.BlockGroup },
                new { label = "sample_fb", obj = (IEngineeringServiceProvider)firstFb },
            };

            object acquiredService = null;
            string acquiredOn = null;
            foreach (var candidate in parents)
            {
                var labelProp = candidate.GetType().GetProperty("label").GetValue(candidate) as string;
                var objProp = candidate.GetType().GetProperty("obj").GetValue(candidate);
                if (objProp == null) { tries.Add(new { parent = labelProp, skipped = "null" }); continue; }
                try
                {
                    var gm = getServiceGeneric.MakeGenericMethod(svcType);
                    var svc = gm.Invoke(objProp, null);
                    tries.Add(new
                    {
                        parent = labelProp,
                        returned_null = svc == null,
                        returned_type = svc?.GetType().FullName,
                    });
                    if (svc != null && acquiredService == null)
                    {
                        acquiredService = svc;
                        acquiredOn = labelProp;
                    }
                }
                catch (Exception ex)
                {
                    tries.Add(new { parent = labelProp, error = ex.InnerException?.Message ?? ex.Message });
                }
            }

            // Stash the acquired service for the next probe via a field
            _spikeAcquiredCrossRefService = acquiredService;
            _spikeAcquiredCrossRefServiceParent = acquiredOn;

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["service_type"] = svcType.FullName,
                    ["attempts"] = tries,
                    ["acquired_on"] = acquiredOn,
                },
                ItemCount = tries.Count,
                Notes = acquiredService != null
                    ? $"acquired CrossReferenceService via {acquiredOn}"
                    : "could not acquire CrossReferenceService on any parent",
            };
        }

        private object _spikeAcquiredCrossRefService;
        private string _spikeAcquiredCrossRefServiceParent;

        private ProbeResult Probe_CrossRefMethodSignatures(string outDir)
        {
            Type svcType = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceService");
            if (svcType == null)
                return new ProbeResult { Data = new { error = "CrossReferenceService type not found" }, Notes = "type missing" };

            var methods = svcType
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(m => new
                {
                    name = m.Name,
                    return_type = m.ReturnType.FullName,
                    parameters = m.GetParameters().Select(p => new
                    {
                        name = p.Name,
                        type = p.ParameterType.FullName,
                        is_optional = p.IsOptional,
                        has_default = p.HasDefaultValue,
                        default_value = p.HasDefaultValue ? p.DefaultValue?.ToString() : null,
                    }).ToList(),
                })
                .OrderBy(m => m.name)
                .ToList();

            // Also reflect CrossReferenceResult + SourceObject + ReferenceObject + Location methods
            var allTypes = new[]
            {
                "Siemens.Engineering.CrossReference.CrossReferenceResult",
                "Siemens.Engineering.CrossReference.SourceObject",
                "Siemens.Engineering.CrossReference.ReferenceObject",
                "Siemens.Engineering.CrossReference.Location",
                "Siemens.Engineering.CrossReference.CrossReferenceServiceFactoryFacade",
            };
            var detail = new List<object>();
            foreach (var name in allTypes)
            {
                var t = FindTypeByName(name);
                if (t == null) { detail.Add(new { type = name, missing = true }); continue; }
                detail.Add(new
                {
                    type = name,
                    methods = t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                               .Select(m => new
                               {
                                   name = m.Name,
                                   is_static = m.IsStatic,
                                   return_type = m.ReturnType.FullName,
                                   parameters = m.GetParameters().Select(p => $"{p.ParameterType.FullName} {p.Name}").ToList(),
                               })
                               .OrderBy(m => m.name)
                               .ToList(),
                });
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["CrossReferenceService_methods"] = methods,
                    ["supporting_types"] = detail,
                },
                ItemCount = methods.Count,
                Notes = $"{methods.Count} declared methods on CrossReferenceService",
            };
        }

        private ProbeResult Probe_CrossRefSampleEnumeration(string outDir)
        {
            if (_spikeAcquiredCrossRefService == null)
                return new ProbeResult { Data = new { warning = "no service acquired in V2 probe 1" }, Notes = "skipped — no service" };

            Type svcType = _spikeAcquiredCrossRefService.GetType();
            PlcSoftware plc = GetPlcSoftware();
            PlcBlock firstFb = FindFirstBlockMatching(plc.BlockGroup, b => b is FB);

            // Find all overloads of GetCrossReferences
            var overloads = svcType.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                                   .Where(m => m.Name == "GetCrossReferences")
                                   .ToList();

            Type filterEnum = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceFilter");

            var attempts = new List<object>();
            object successResult = null;
            string successVariant = null;

            foreach (var m in overloads)
            {
                var ps = m.GetParameters();
                var sig = $"GetCrossReferences({string.Join(", ", ps.Select(p => p.ParameterType.Name))})";
                // Build a plausible argument tuple. Only invoke if we can fill every param.
                object[] args = new object[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    var pt = ps[i].ParameterType;
                    if (pt.IsAssignableFrom(typeof(PlcBlock))) { args[i] = firstFb; }
                    else if (pt.IsAssignableFrom(typeof(PlcSoftware))) { args[i] = plc; }
                    else if (pt.IsAssignableFrom(typeof(Project))) { args[i] = _project; }
                    else if (pt == filterEnum && filterEnum != null)
                    {
                        // Use AllObjects (=0 conventionally; safer via Enum.Parse)
                        try { args[i] = Enum.Parse(filterEnum, "AllObjects"); }
                        catch { args[i] = Activator.CreateInstance(filterEnum); }
                    }
                    else if (typeof(IEnumerable).IsAssignableFrom(pt))
                    {
                        // Best guess — empty list in expected element type
                        args[i] = null;  // null often accepted by Openness as "all"
                    }
                    else if (pt.IsValueType)
                    {
                        args[i] = Activator.CreateInstance(pt);
                    }
                    else
                    {
                        args[i] = null;
                    }
                }
                var sw = Stopwatch.StartNew();
                try
                {
                    var result = m.Invoke(_spikeAcquiredCrossRefService, args);
                    sw.Stop();
                    attempts.Add(new { signature = sig, ok = true, result_type = result?.GetType().FullName, elapsed_ms = sw.Elapsed.TotalMilliseconds, args_used = args.Select(a => a?.GetType().FullName ?? "null").ToList() });
                    if (result != null && successResult == null)
                    {
                        successResult = result;
                        successVariant = sig;
                    }
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    attempts.Add(new { signature = sig, ok = false, elapsed_ms = sw.Elapsed.TotalMilliseconds, error = ex.InnerException?.Message ?? ex.Message });
                }
            }

            var data = new Dictionary<string, object>
            {
                ["overload_count"] = overloads.Count,
                ["invocation_attempts"] = attempts,
                ["successful_variant"] = successVariant,
            };

            // If we got a result, walk it and dump a sample
            if (successResult != null)
            {
                try
                {
                    data["result_sample"] = WalkCrossRefResult(successResult, maxSources: 5, maxRefsPerSource: 5, maxLocations: 5);
                }
                catch (Exception ex)
                {
                    data["walk_error"] = ex.Message;
                }
            }

            return new ProbeResult
            {
                Data = data,
                Notes = successResult != null ? $"invoked: {successVariant}" : "no overload invoked cleanly",
            };
        }

        private object WalkCrossRefResult(object result, int maxSources, int maxRefsPerSource, int maxLocations)
        {
            // Handle either CrossReferenceResult OR a direct composition
            var resultType = result.GetType();
            object sourcesCollection = null;
            var sourcesProp = resultType.GetProperty("Sources");
            if (sourcesProp != null) sourcesCollection = sourcesProp.GetValue(result);
            if (sourcesCollection == null && result is IEnumerable) sourcesCollection = result;
            if (sourcesCollection == null) return new { note = "no Sources property or enumerable", type = resultType.FullName };

            var sources = new List<object>();
            int sCount = 0;
            foreach (var src in (IEnumerable)sourcesCollection)
            {
                if (sCount++ >= maxSources) break;
                sources.Add(RenderSourceObject(src, maxRefsPerSource, maxLocations));
            }
            return new
            {
                total_sources_iterated = sCount,
                sample_sources = sources,
                result_type = resultType.FullName,
            };
        }

        private object RenderSourceObject(object src, int maxRefs, int maxLocations)
        {
            if (src == null) return null;
            var t = src.GetType();
            var data = new Dictionary<string, object>
            {
                ["__type"] = t.FullName,
                ["name"] = SafeCall(() => t.GetProperty("Name")?.GetValue(src)?.ToString()),
                ["path"] = SafeCall(() => t.GetProperty("Path")?.GetValue(src)?.ToString()),
                ["address"] = SafeCall(() => t.GetProperty("Address")?.GetValue(src)?.ToString()),
                ["type_name"] = SafeCall(() => t.GetProperty("TypeName")?.GetValue(src)?.ToString()),
                ["device"] = SafeCall(() => t.GetProperty("Device")?.GetValue(src)?.ToString()),
                ["underlying_type"] = SafeCall(() => t.GetProperty("UnderlyingObject")?.GetValue(src)?.GetType().FullName),
            };

            // Children
            var childrenProp = t.GetProperty("Children");
            int childCount = 0;
            if (childrenProp != null)
            {
                try
                {
                    var children = childrenProp.GetValue(src) as IEnumerable;
                    if (children != null)
                    {
                        foreach (var _ in children) { childCount++; if (childCount >= 20) break; }
                    }
                }
                catch { }
            }
            data["children_count"] = childCount;

            // References
            var refsProp = t.GetProperty("References");
            if (refsProp != null)
            {
                try
                {
                    var refs = refsProp.GetValue(src) as IEnumerable;
                    var refList = new List<object>();
                    int rCount = 0;
                    if (refs != null)
                    {
                        foreach (var refObj in refs)
                        {
                            if (rCount++ >= maxRefs) break;
                            refList.Add(RenderReferenceObject(refObj, maxLocations));
                        }
                    }
                    data["total_refs_iterated"] = rCount;
                    data["references"] = refList;
                }
                catch (Exception ex) { data["refs_error"] = ex.Message; }
            }

            return data;
        }

        private object RenderReferenceObject(object refObj, int maxLocations)
        {
            if (refObj == null) return null;
            var t = refObj.GetType();
            var data = new Dictionary<string, object>
            {
                ["__type"] = t.FullName,
                ["name"] = SafeCall(() => t.GetProperty("Name")?.GetValue(refObj)?.ToString()),
                ["path"] = SafeCall(() => t.GetProperty("Path")?.GetValue(refObj)?.ToString()),
                ["address"] = SafeCall(() => t.GetProperty("Address")?.GetValue(refObj)?.ToString()),
                ["type_name"] = SafeCall(() => t.GetProperty("TypeName")?.GetValue(refObj)?.ToString()),
                ["device"] = SafeCall(() => t.GetProperty("Device")?.GetValue(refObj)?.ToString()),
            };

            var locsProp = t.GetProperty("Locations");
            if (locsProp != null)
            {
                try
                {
                    var locs = locsProp.GetValue(refObj) as IEnumerable;
                    var locList = new List<object>();
                    int lCount = 0;
                    if (locs != null)
                    {
                        foreach (var loc in locs)
                        {
                            if (lCount++ >= maxLocations) break;
                            var lt = loc.GetType();
                            locList.Add(new Dictionary<string, object>
                            {
                                ["__type"] = lt.FullName,
                                ["access"] = SafeCall(() => lt.GetProperty("Access")?.GetValue(loc)?.ToString()),
                                ["address"] = SafeCall(() => lt.GetProperty("Address")?.GetValue(loc)?.ToString()),
                                ["name"] = SafeCall(() => lt.GetProperty("Name")?.GetValue(loc)?.ToString()),
                                ["reference_location"] = SafeCall(() => lt.GetProperty("ReferenceLocation")?.GetValue(loc)?.ToString()),
                                ["reference_type"] = SafeCall(() => lt.GetProperty("ReferenceType")?.GetValue(loc)?.ToString()),
                                ["referenced_as"] = SafeCall(() => lt.GetProperty("ReferencedAs")?.GetValue(loc)?.ToString()),
                                ["referenced_as_name"] = SafeCall(() => lt.GetProperty("ReferencedAsName")?.GetValue(loc)?.ToString()),
                                ["type_name"] = SafeCall(() => lt.GetProperty("TypeName")?.GetValue(loc)?.ToString()),
                            });
                        }
                    }
                    data["total_locations_iterated"] = lCount;
                    data["locations"] = locList;
                }
                catch (Exception ex) { data["locs_error"] = ex.Message; }
            }

            return data;
        }

        private ProbeResult Probe_DriveDataProvider(string outDir)
        {
            DeviceItem drive = null;
            foreach (Device dev in _project.Devices)
            {
                drive = FindSinamicsIn(dev.DeviceItems);
                if (drive != null) break;
            }
            if (drive == null)
                return new ProbeResult { Data = new { warning = "no Sinamics device" }, Notes = "no Sinamics" };

            var engAsm = typeof(Siemens.Engineering.Project).Assembly;
            var serviceTypeCandidates = engAsm.GetTypes()
                .Where(t => t != null && !t.IsInterface)
                .Where(t => t.FullName != null && t.FullName.StartsWith("Siemens.Engineering."))
                .Where(t => t.Name.IndexOf("DataProvider", StringComparison.OrdinalIgnoreCase) >= 0
                         || t.Name.IndexOf("ParameterProvider", StringComparison.OrdinalIgnoreCase) >= 0
                         || t.Name.IndexOf("Parameter", StringComparison.OrdinalIgnoreCase) >= 0
                         || t.Name.EndsWith("Service")
                         || t.Name.IndexOf("Drive", StringComparison.OrdinalIgnoreCase) >= 0)
                .Where(t => !t.IsGenericType && !t.IsGenericTypeDefinition)
                .OrderBy(t => t.FullName)
                .ToList();

            var getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods().FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);

            var hits = new List<object>();
            foreach (var candidate in serviceTypeCandidates)
            {
                try
                {
                    var gm = getServiceGeneric.MakeGenericMethod(candidate);
                    var svc = gm.Invoke(drive, null);
                    if (svc != null)
                    {
                        hits.Add(new
                        {
                            service_type = candidate.FullName,
                            returned_type = svc.GetType().FullName,
                            members = svc.GetType().GetMembers(BindingFlags.Public | BindingFlags.Instance)
                                        .Select(m => $"{m.MemberType} {m.Name}")
                                        .Distinct()
                                        .Take(50)
                                        .ToList(),
                        });
                    }
                }
                catch { /* swallow, only record hits */ }
            }

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["drive_name"] = drive.Name,
                    ["candidate_type_count"] = serviceTypeCandidates.Count,
                    ["candidates_sampled"] = serviceTypeCandidates.Take(20).Select(t => t.FullName).ToList(),
                    ["services_returning_nonnull"] = hits,
                },
                ItemCount = hits.Count,
                Notes = $"{hits.Count} services returned non-null out of {serviceTypeCandidates.Count} candidates",
            };
        }

        private ProbeResult Probe_DriveChildTypeScan(string outDir)
        {
            DeviceItem drive = null;
            foreach (Device dev in _project.Devices)
            {
                drive = FindSinamicsIn(dev.DeviceItems);
                if (drive != null) break;
            }
            if (drive == null)
                return new ProbeResult { Data = new { warning = "no Sinamics device" }, Notes = "no Sinamics" };

            // Recursively walk children, capturing each's TYPE hierarchy + non-default properties
            var tree = RenderDriveNode(drive, depth: 0, maxDepth: 5);

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["root_drive"] = drive.Name,
                    ["tree"] = tree,
                },
                Notes = $"drive '{drive.Name}' tree walk complete",
            };
        }

        private object RenderDriveNode(DeviceItem item, int depth, int maxDepth)
        {
            var t = item.GetType();
            var children = new List<object>();
            if (depth < maxDepth)
            {
                foreach (DeviceItem child in item.DeviceItems)
                {
                    children.Add(RenderDriveNode(child, depth + 1, maxDepth));
                }
            }
            return new Dictionary<string, object>
            {
                ["name"] = item.Name,
                ["type_id"] = SafeCall(() => item.TypeIdentifier),
                ["classification"] = SafeCall(() => t.GetProperty("Classification")?.GetValue(item)?.ToString()),
                ["position"] = SafeCall(() => t.GetProperty("PositionNumber")?.GetValue(item)?.ToString()),
                ["type_hierarchy"] = EnumerateTypeHierarchy(t),
                ["non_default_attributes"] = ProbeDriveAttributesByReflection(item),
                ["children"] = children,
            };
        }

        private static List<string> EnumerateTypeHierarchy(Type t)
        {
            var list = new List<string>();
            var cur = t;
            while (cur != null && cur != typeof(object))
            {
                list.Add(cur.FullName);
                cur = cur.BaseType;
            }
            return list;
        }

        private static List<object> ProbeDriveAttributesByReflection(DeviceItem item)
        {
            // Use GetAttributeInfos to discover what attributes this item actually supports
            var list = new List<object>();
            try
            {
                var infos = item.GetAttributeInfos();
                foreach (var info in infos)
                {
                    try
                    {
                        string attrName = info.GetType().GetProperty("Name")?.GetValue(info)?.ToString();
                        if (string.IsNullOrEmpty(attrName)) continue;
                        object val = null;
                        try { val = item.GetAttribute(attrName); } catch { }
                        list.Add(new { name = attrName, value = val?.ToString(), value_type = val?.GetType().FullName });
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                list.Add(new { reflection_error = ex.Message });
            }
            return list;
        }
    }
}
