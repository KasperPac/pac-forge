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

            // ── V3 probes: residuals from step 0 ──
            RunProbe(resp, "cross_references_v3", "plc_software_bulk_enum", outDir, Probe_PlcSoftwareBulkCrossRef);
            RunProbe(resp, "cross_references_v3", "udt_array_resolution", outDir, Probe_UdtArrayResolution);
            RunProbe(resp, "hardware_v3", "drive_object_walk", outDir, Probe_DriveObjectWalk);

            // ── V4 probe: unreachable-devices hunt (PROFINET IO slaves, ET200SP, Beckhoff, etc.) ──
            RunProbe(resp, "hardware_v4", "all_device_collections", outDir, Probe_AllDeviceCollections);

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

        // ── V3 probes ──────────────────────────────────────────────────────

        private ProbeResult Probe_PlcSoftwareBulkCrossRef(string outDir)
        {
            Type svcType = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceService");
            Type filterEnum = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceFilter");
            if (svcType == null || filterEnum == null)
                return new ProbeResult { Data = new { error = "required types not found" }, Notes = "types missing" };

            PlcSoftware plc = GetPlcSoftware();
            var getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods().FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);

            // Try acquiring on several parents, in order of preference for bulk enumeration
            var parents = new (string label, IEngineeringServiceProvider target)[]
            {
                ("plc_software", plc),
                ("block_group_root", plc.BlockGroup),
                ("type_group_root", plc.TypeGroup),
                ("tag_table_group", plc.TagTableGroup),
                ("project", _project),
            };

            var attempts = new List<object>();
            object bestResult = null;
            string bestParent = null;
            int bestSourceCount = 0;
            double bestEnumMs = 0;

            foreach (var p in parents)
            {
                try
                {
                    var gm = getServiceGeneric.MakeGenericMethod(svcType);
                    var svc = gm.Invoke(p.target, null);
                    if (svc == null) { attempts.Add(new { parent = p.label, acquired = false }); continue; }

                    // Invoke GetCrossReferences(AllObjects) and time it
                    var enumMethod = svcType.GetMethods().FirstOrDefault(m => m.Name == "GetCrossReferences");
                    var filterVal = Enum.Parse(filterEnum, "AllObjects");
                    var sw = Stopwatch.StartNew();
                    object result = null;
                    Exception callEx = null;
                    try { result = enumMethod.Invoke(svc, new object[] { filterVal }); }
                    catch (Exception ex) { callEx = ex.InnerException ?? ex; }
                    sw.Stop();

                    if (callEx != null)
                    {
                        attempts.Add(new { parent = p.label, acquired = true, invoke_error = callEx.Message, elapsed_ms = sw.Elapsed.TotalMilliseconds });
                        continue;
                    }

                    // Count sources without walking deep
                    int sourceCount = 0;
                    try
                    {
                        var sourcesProp = result.GetType().GetProperty("Sources");
                        var sources = sourcesProp?.GetValue(result) as IEnumerable;
                        if (sources != null)
                        {
                            foreach (var _ in sources) sourceCount++;
                        }
                    }
                    catch { }

                    attempts.Add(new
                    {
                        parent = p.label,
                        acquired = true,
                        service_type = svc.GetType().FullName,
                        result_type = result?.GetType().FullName,
                        source_count = sourceCount,
                        elapsed_ms = sw.Elapsed.TotalMilliseconds,
                    });

                    if (sourceCount > bestSourceCount)
                    {
                        bestResult = result;
                        bestParent = p.label;
                        bestSourceCount = sourceCount;
                        bestEnumMs = sw.Elapsed.TotalMilliseconds;
                    }
                }
                catch (Exception ex)
                {
                    attempts.Add(new { parent = p.label, outer_error = ex.InnerException?.Message ?? ex.Message });
                }
            }

            var data = new Dictionary<string, object>
            {
                ["attempts"] = attempts,
                ["best_parent"] = bestParent,
                ["best_source_count"] = bestSourceCount,
                ["best_enum_ms"] = bestEnumMs,
            };

            if (bestResult != null)
            {
                // Walk a short sample of the bulk result
                try { data["sample"] = WalkCrossRefResult(bestResult, maxSources: 3, maxRefsPerSource: 3, maxLocations: 2); }
                catch (Exception ex) { data["walk_error"] = ex.Message; }

                // Stash the bulk result for Probe_UdtArrayResolution
                _spikeBulkCrossRefResult = bestResult;
            }

            return new ProbeResult
            {
                Data = data,
                ItemCount = bestSourceCount,
                Notes = bestResult != null
                    ? $"bulk enum via '{bestParent}': {bestSourceCount} sources in {bestEnumMs:F0}ms"
                    : "no parent yielded a usable bulk enumeration",
            };
        }

        private object _spikeBulkCrossRefResult;

        private ProbeResult Probe_UdtArrayResolution(string outDir)
        {
            // Strategy: scan the bulk result (or per-block results) for any Name/Path/ReferencedAsName
            // containing '[' — those are array-indexed access paths. Dump the exact shape verbatim.
            // Keep the first N hits and classify as literal-index vs wildcard.
            var hits = new List<object>();
            int scannedSources = 0;
            int scannedRefs = 0;
            int scannedLocations = 0;

            object resultToScan = _spikeBulkCrossRefResult;
            if (resultToScan == null)
            {
                // Fallback: build our own per-block list by iterating FBs/FCs
                PlcSoftware plc = GetPlcSoftware();
                Type svcType = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceService");
                Type filterEnum = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceFilter");
                var getServiceGeneric = typeof(IEngineeringServiceProvider)
                    .GetMethods().FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);

                var blocks = new List<PlcBlock>();
                CollectBlocks(plc.BlockGroup, blocks);
                // Prefer LAD/SCL blocks over DBs — code blocks are where array writes happen
                var codeBlocks = blocks.Where(b => b is FB || b is FC).Take(80).ToList();

                int blocksScanned = 0;
                foreach (var b in codeBlocks)
                {
                    if (hits.Count >= 20) break;
                    blocksScanned++;
                    try
                    {
                        var gm = getServiceGeneric.MakeGenericMethod(svcType);
                        var svc = gm.Invoke(b, null);
                        if (svc == null) continue;
                        var m = svcType.GetMethods().First(x => x.Name == "GetCrossReferences");
                        var result = m.Invoke(svc, new object[] { Enum.Parse(filterEnum, "AllObjects") });
                        ScanForArrayAccess(result, hits, ref scannedSources, ref scannedRefs, ref scannedLocations, b.Name);
                    }
                    catch { }
                }
                return new ProbeResult
                {
                    Data = new Dictionary<string, object>
                    {
                        ["strategy"] = "per-block-scan (bulk result unavailable)",
                        ["blocks_scanned"] = blocksScanned,
                        ["sources_scanned"] = scannedSources,
                        ["references_scanned"] = scannedRefs,
                        ["locations_scanned"] = scannedLocations,
                        ["array_access_hits"] = hits,
                        ["hit_classification"] = ClassifyArrayHits(hits),
                    },
                    ItemCount = hits.Count,
                    Notes = $"scanned {blocksScanned} blocks, {hits.Count} array-access hits",
                };
            }

            ScanForArrayAccess(resultToScan, hits, ref scannedSources, ref scannedRefs, ref scannedLocations, null);

            return new ProbeResult
            {
                Data = new Dictionary<string, object>
                {
                    ["strategy"] = "bulk-result-scan",
                    ["sources_scanned"] = scannedSources,
                    ["references_scanned"] = scannedRefs,
                    ["locations_scanned"] = scannedLocations,
                    ["array_access_hits"] = hits,
                    ["hit_classification"] = ClassifyArrayHits(hits),
                },
                ItemCount = hits.Count,
                Notes = $"{hits.Count} array-access hits from {scannedRefs} refs in bulk result",
            };
        }

        private void ScanForArrayAccess(object result, List<object> hits, ref int scannedSources, ref int scannedRefs, ref int scannedLocations, string sourceBlockHint)
        {
            var resultType = result.GetType();
            var sourcesProp = resultType.GetProperty("Sources");
            var sources = sourcesProp?.GetValue(result) as IEnumerable;
            if (sources == null) sources = result as IEnumerable;
            if (sources == null) return;

            foreach (var src in sources)
            {
                scannedSources++;
                if (hits.Count >= 20) return;
                var st = src.GetType();
                string srcName = SafeCall(() => st.GetProperty("Name")?.GetValue(src)?.ToString()) as string;
                string srcPath = SafeCall(() => st.GetProperty("Path")?.GetValue(src)?.ToString()) as string;

                var refsProp = st.GetProperty("References");
                var refs = refsProp?.GetValue(src) as IEnumerable;
                if (refs == null) continue;

                foreach (var r in refs)
                {
                    scannedRefs++;
                    if (hits.Count >= 20) return;
                    var rt = r.GetType();
                    string refName = SafeCall(() => rt.GetProperty("Name")?.GetValue(r)?.ToString()) as string;
                    string refPath = SafeCall(() => rt.GetProperty("Path")?.GetValue(r)?.ToString()) as string;
                    string refAddress = SafeCall(() => rt.GetProperty("Address")?.GetValue(r)?.ToString()) as string;

                    bool refHasBracket =
                        (refName != null && refName.IndexOf('[') >= 0) ||
                        (refPath != null && refPath.IndexOf('[') >= 0);

                    var locsProp = rt.GetProperty("Locations");
                    var locs = locsProp?.GetValue(r) as IEnumerable;
                    if (locs == null && !refHasBracket) continue;

                    var matchingLocs = new List<object>();
                    if (locs != null)
                    {
                        foreach (var loc in locs)
                        {
                            scannedLocations++;
                            var lt = loc.GetType();
                            string locName = SafeCall(() => lt.GetProperty("Name")?.GetValue(loc)?.ToString()) as string;
                            string locAddr = SafeCall(() => lt.GetProperty("Address")?.GetValue(loc)?.ToString()) as string;
                            string locRefAs = SafeCall(() => lt.GetProperty("ReferencedAsName")?.GetValue(loc)?.ToString()) as string;
                            string locRefLoc = SafeCall(() => lt.GetProperty("ReferenceLocation")?.GetValue(loc)?.ToString()) as string;

                            bool locHasBracket =
                                (locName != null && locName.IndexOf('[') >= 0) ||
                                (locAddr != null && locAddr.IndexOf('[') >= 0) ||
                                (locRefAs != null && locRefAs.IndexOf('[') >= 0) ||
                                (locRefLoc != null && locRefLoc.IndexOf('[') >= 0);

                            if (locHasBracket || refHasBracket)
                            {
                                matchingLocs.Add(new
                                {
                                    access = SafeCall(() => lt.GetProperty("Access")?.GetValue(loc)?.ToString()),
                                    reference_type = SafeCall(() => lt.GetProperty("ReferenceType")?.GetValue(loc)?.ToString()),
                                    reference_location = locRefLoc,
                                    name = locName,
                                    address = locAddr,
                                    referenced_as_name = locRefAs,
                                });
                            }
                        }
                    }

                    if (matchingLocs.Count > 0 || refHasBracket)
                    {
                        hits.Add(new
                        {
                            source_block = sourceBlockHint ?? srcName,
                            source_path = srcPath,
                            ref_name = refName,
                            ref_path = refPath,
                            ref_address = refAddress,
                            matching_locations = matchingLocs,
                        });
                    }
                }
            }
        }

        private static object ClassifyArrayHits(List<object> hits)
        {
            int literal = 0, wildcard = 0, other = 0;
            var samples = new { literal = new List<string>(), wildcard = new List<string>() };
            foreach (var h in hits)
            {
                // Pull strings that might contain array indices
                var t = h.GetType();
                string name = (string)t.GetProperty("ref_name")?.GetValue(h);
                string path = (string)t.GetProperty("ref_path")?.GetValue(h);
                string candidate = name ?? path ?? "";
                int lb = candidate.IndexOf('[');
                int rb = lb >= 0 ? candidate.IndexOf(']', lb) : -1;
                if (lb < 0 || rb < 0) { other++; continue; }
                string inside = candidate.Substring(lb + 1, rb - lb - 1).Trim();
                if (inside == "*" || inside == "")
                {
                    wildcard++;
                    if (samples.wildcard.Count < 5) samples.wildcard.Add(candidate);
                }
                else if (int.TryParse(inside, out _))
                {
                    literal++;
                    if (samples.literal.Count < 5) samples.literal.Add(candidate);
                }
                else
                {
                    other++;
                }
            }
            return new
            {
                literal_index_count = literal,
                wildcard_count = wildcard,
                other_count = other,
                samples_literal = samples.literal,
                samples_wildcard = samples.wildcard,
            };
        }

        private ProbeResult Probe_DriveObjectWalk(string outDir)
        {
            Type containerType = FindTypeByName("Siemens.Engineering.MC.Drives.DriveObjectContainer");
            if (containerType == null)
                return new ProbeResult { Data = new { error = "DriveObjectContainer type not found" }, Notes = "type missing" };

            DeviceItem drive = null;
            foreach (Device dev in _project.Devices)
            {
                drive = FindSinamicsIn(dev.DeviceItems);
                if (drive != null) break;
            }
            if (drive == null)
                return new ProbeResult { Data = new { warning = "no Sinamics device found" }, Notes = "no Sinamics" };

            var getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods().FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);
            var gm = getServiceGeneric.MakeGenericMethod(containerType);
            object container = gm.Invoke(drive, null);
            if (container == null)
                return new ProbeResult { Data = new { warning = "container returned null" }, Notes = "null container" };

            // Dump container members + DriveObjects collection contents
            var data = new Dictionary<string, object>
            {
                ["drive_name"] = drive.Name,
                ["container_type"] = container.GetType().FullName,
                ["container_properties"] = SafeReflectAllProps(container, maxDepth: 1),
            };

            // Enumerate DriveObjects
            var driveObjectsProp = container.GetType().GetProperty("DriveObjects");
            var driveObjectsList = new List<object>();
            int driveObjectCount = 0;
            if (driveObjectsProp != null)
            {
                var coll = driveObjectsProp.GetValue(container) as IEnumerable;
                if (coll != null)
                {
                    foreach (var driveObj in coll)
                    {
                        driveObjectCount++;
                        if (driveObjectsList.Count >= 5) continue;  // keep dump bounded
                        driveObjectsList.Add(ReflectDriveObject(driveObj));
                    }
                }
            }
            data["drive_object_count"] = driveObjectCount;
            data["drive_object_samples"] = driveObjectsList;

            // Also reflect on DriveObject type statically to catalog its methods/properties
            Type driveObjectType = FindTypeByName("Siemens.Engineering.MC.Drives.DriveObject")
                                ?? FindTypeByName("Siemens.Engineering.MC.DriveConfiguration.DriveObject");
            if (driveObjectType != null)
            {
                data["drive_object_type"] = driveObjectType.FullName;
                data["drive_object_static_members"] = driveObjectType
                    .GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Select(m => new
                    {
                        kind = m.MemberType.ToString(),
                        name = m.Name,
                        detail = (m is MethodInfo mi) ? $"({string.Join(",", mi.GetParameters().Select(p => p.ParameterType.Name))}) -> {mi.ReturnType.Name}"
                               : (m is PropertyInfo pi) ? pi.PropertyType.FullName
                               : ""
                    })
                    .ToList();
            }

            return new ProbeResult
            {
                Data = data,
                ItemCount = driveObjectCount,
                Notes = $"{driveObjectCount} DriveObjects on {drive.Name}",
            };
        }

        private object ReflectDriveObject(object driveObj)
        {
            if (driveObj == null) return null;
            var t = driveObj.GetType();
            var result = new Dictionary<string, object>
            {
                ["__type"] = t.FullName,
                ["properties"] = SafeReflectAllProps(driveObj, maxDepth: 1),
            };

            // GetAttributeInfos to discover actual attribute names + values
            var attrInfos = new List<object>();
            try
            {
                var getAttrInfos = t.GetMethod("GetAttributeInfos", Type.EmptyTypes);
                if (getAttrInfos != null)
                {
                    var infos = getAttrInfos.Invoke(driveObj, null) as IEnumerable;
                    if (infos != null)
                    {
                        foreach (var info in infos)
                        {
                            try
                            {
                                var it = info.GetType();
                                string name = it.GetProperty("Name")?.GetValue(info)?.ToString();
                                if (string.IsNullOrEmpty(name)) continue;
                                object val = null;
                                try
                                {
                                    var getAttrMethod = t.GetMethod("GetAttribute", new[] { typeof(string) });
                                    val = getAttrMethod?.Invoke(driveObj, new object[] { name });
                                }
                                catch { }
                                attrInfos.Add(new { name, value = val?.ToString(), type = val?.GetType().FullName });
                            }
                            catch { }
                        }
                    }
                }
            }
            catch (Exception ex) { attrInfos.Add(new { error = ex.Message }); }
            result["attributes_via_getattributeinfos"] = attrInfos;

            // Walk nested engineering objects — DriveObject might have Telegrams / Parameters collection
            try
            {
                foreach (var propName in new[] { "Telegrams", "Parameters", "Submodules", "DriveObjects", "Items", "DeviceItems" })
                {
                    var p = t.GetProperty(propName);
                    if (p == null) continue;
                    var val = p.GetValue(driveObj);
                    if (val == null) { result[$"prop_{propName}"] = null; continue; }
                    if (val is IEnumerable en)
                    {
                        var n = 0;
                        var previews = new List<object>();
                        foreach (var x in en)
                        {
                            if (n++ >= 5) { previews.Add("… truncated"); break; }
                            previews.Add(new { type = x?.GetType().FullName, name = SafeCall(() => x?.GetType().GetProperty("Name")?.GetValue(x)?.ToString()) });
                        }
                        result[$"prop_{propName}"] = new { count = n, preview = previews };
                    }
                    else
                    {
                        result[$"prop_{propName}"] = val.GetType().FullName;
                    }
                }
            }
            catch (Exception ex) { result["nested_walk_error"] = ex.Message; }

            return result;
        }

        // V4 — hunt for PROFINET IO slaves / ET200SP / Beckhoff couplers that don't surface
        // through `_project.Devices`. Systematically enumerate every Device-bearing collection
        // reachable from `_project` via reflection, plus walk `DeviceGroups` recursively.
        private ProbeResult Probe_AllDeviceCollections(string outDir)
        {
            var data = new Dictionary<string, object>();

            // 1. Canonical path — _project.Devices.Count + names (for baseline diff)
            var canonicalNames = new List<string>();
            int canonicalCount = 0;
            try
            {
                foreach (Device d in _project.Devices)
                {
                    canonicalCount++;
                    if (canonicalNames.Count < 200) canonicalNames.Add(d.Name + " | " + (SafeCall(() => d.TypeIdentifier) as string ?? "?"));
                }
            }
            catch (Exception ex) { data["project_devices_error"] = ex.Message; }
            data["project_devices_count"] = canonicalCount;
            data["project_devices_names"] = canonicalNames;

            // 2. _project.DeviceGroups recursive walk
            var groupedDevices = new List<string>();
            int groupedCount = 0;
            try { WalkDeviceGroups(_project.DeviceGroups, groupedDevices, ref groupedCount); }
            catch (Exception ex) { data["device_groups_error"] = ex.Message; }
            data["device_groups_device_count"] = groupedCount;
            data["device_groups_sample"] = groupedDevices.Take(200).ToList();

            // 2b. UngroupedDevicesGroup — the special project-level "Ungrouped devices" folder
            //     where PROFINET I/O slaves (ET200SP heads, Beckhoff couplers, etc.) often land
            //     on V20.
            var ungroupedNames = new List<string>();
            int ungroupedCount = 0;
            try
            {
                var ugProp = _project.GetType().GetProperty("UngroupedDevicesGroup");
                object ug = ugProp?.GetValue(_project);
                if (ug != null)
                {
                    data["ungrouped_group_runtime_type"] = ug.GetType().FullName;
                    var devicesProp = ug.GetType().GetProperty("Devices");
                    var groupsProp = ug.GetType().GetProperty("Groups");
                    if (devicesProp != null)
                    {
                        var devEn = devicesProp.GetValue(ug) as IEnumerable;
                        if (devEn != null)
                        {
                            foreach (Device d in devEn)
                            {
                                ungroupedCount++;
                                if (ungroupedNames.Count < 200)
                                    ungroupedNames.Add(d.Name + " | " + (SafeCall(() => d.TypeIdentifier) as string ?? "?"));
                            }
                        }
                    }
                    // Recurse into sub-groups if any.
                    if (groupsProp != null)
                    {
                        WalkDeviceGroups(groupsProp.GetValue(ug), ungroupedNames, ref ungroupedCount);
                    }
                }
            }
            catch (Exception ex) { data["ungrouped_group_error"] = ex.Message; }
            data["ungrouped_devices_count"] = ungroupedCount;
            data["ungrouped_devices_sample"] = ungroupedNames.Take(200).ToList();

            // 3. Reflection sweep — every public property on Project returning IEnumerable<Device>
            //    or containing something called "Ungrouped" / "IoDevice" / "Slave"
            var reflectionHits = new List<object>();
            try
            {
                var projType = _project.GetType();
                foreach (var prop in projType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    object val = null;
                    try { val = prop.GetValue(_project); } catch { continue; }
                    if (val == null) continue;

                    string typeName = val.GetType().FullName ?? "";
                    bool looksLikeDeviceBag =
                        typeName.Contains("Device") ||
                        prop.Name.IndexOf("Ungrouped", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        prop.Name.IndexOf("Slave", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        prop.Name.IndexOf("IoDevice", StringComparison.OrdinalIgnoreCase) >= 0;
                    if (!looksLikeDeviceBag) continue;

                    var hit = new Dictionary<string, object>
                    {
                        ["property"] = prop.Name,
                        ["declared_type"] = prop.PropertyType.FullName,
                        ["runtime_type"] = typeName,
                    };

                    var en = val as IEnumerable;
                    if (en != null && !(val is string))
                    {
                        int i = 0;
                        var preview = new List<string>();
                        foreach (var item in en)
                        {
                            i++;
                            if (preview.Count < 10)
                            {
                                string nm = SafeCall(() => item?.GetType().GetProperty("Name")?.GetValue(item)?.ToString()) as string;
                                string tid = SafeCall(() => item?.GetType().GetProperty("TypeIdentifier")?.GetValue(item)?.ToString()) as string;
                                preview.Add($"{nm} | {tid}");
                            }
                        }
                        hit["count"] = i;
                        hit["preview"] = preview;
                    }
                    reflectionHits.Add(hit);
                }
            }
            catch (Exception ex) { data["reflection_sweep_error"] = ex.Message; }
            data["reflection_hits"] = reflectionHits;

            // 4. Scan the CPU station's DeviceItems for PROFINET IO-system children (some
            //    Openness versions expose IO slaves as sub-items of the master's interface).
            var cpuChildHits = new List<object>();
            try
            {
                foreach (Device d in _project.Devices)
                {
                    foreach (DeviceItem item in d.DeviceItems)
                    {
                        CollectIoDeviceCandidates(item, cpuChildHits, depth: 0);
                    }
                }
            }
            catch (Exception ex) { data["cpu_child_walk_error"] = ex.Message; }
            data["cpu_child_io_candidate_count"] = cpuChildHits.Count;
            data["cpu_child_io_candidates"] = cpuChildHits.Take(100).ToList();

            return new ProbeResult
            {
                Data = data,
                ItemCount = canonicalCount,
                Notes = $"_project.Devices={canonicalCount}, DeviceGroups devices={groupedCount}, UngroupedDevicesGroup.Devices={ungroupedCount}, reflection hits={reflectionHits.Count}, CPU-child IO candidates={cpuChildHits.Count}",
            };
        }

        private void WalkDeviceGroups(object groups, List<string> namesSink, ref int count)
        {
            if (groups == null) return;
            var en = groups as IEnumerable;
            if (en == null) return;
            foreach (var g in en)
            {
                if (g == null) continue;
                string groupName = (SafeCall(() => g.GetType().GetProperty("Name")?.GetValue(g)?.ToString()) as string) ?? "?";

                var devicesProp = g.GetType().GetProperty("Devices");
                if (devicesProp != null)
                {
                    var devEn = devicesProp.GetValue(g) as IEnumerable;
                    if (devEn != null)
                    {
                        foreach (Device d in devEn)
                        {
                            count++;
                            if (namesSink.Count < 200)
                                namesSink.Add($"[{groupName}] {d.Name} | {SafeCall(() => d.TypeIdentifier) as string ?? "?"}");
                        }
                    }
                }

                var nestedProp = g.GetType().GetProperty("Groups");
                if (nestedProp != null)
                {
                    WalkDeviceGroups(nestedProp.GetValue(g), namesSink, ref count);
                }
            }
        }

        private void CollectIoDeviceCandidates(DeviceItem item, List<object> sink, int depth)
        {
            if (item == null || depth > 6) return;
            string cls = SafeCall(() => item.GetType().GetProperty("Classification")?.GetValue(item)?.ToString()) as string;
            string tid = SafeCall(() => item.TypeIdentifier) as string;
            // Anything not CPU/HM/None that has OrderNumber/GSD and lives under an interface is a candidate.
            bool interesting = tid != null && (tid.Contains("OrderNumber:") || tid.Contains("GSD:"))
                            && (cls == null || (cls != "CPU" && cls != "HM" && cls != "None"));
            if (interesting)
            {
                sink.Add(new
                {
                    name = item.Name,
                    type_id = tid,
                    classification = cls,
                    depth,
                    parent_name = SafeCall(() => item.Parent?.GetType().GetProperty("Name")?.GetValue(item.Parent)?.ToString()) as string,
                });
            }
            try
            {
                foreach (DeviceItem child in item.DeviceItems)
                    CollectIoDeviceCandidates(child, sink, depth + 1);
            }
            catch { }
        }
    }
}
