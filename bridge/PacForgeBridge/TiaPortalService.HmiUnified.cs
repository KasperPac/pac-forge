#if !TIA_V18
using System;
using System.Collections.Generic;
using System.Linq;
using Siemens.Engineering;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.HmiUnified;
using Siemens.Engineering.HmiUnified.HmiTags;
using Siemens.Engineering.HmiUnified.HmiConnections;
using Siemens.Engineering.HmiUnified.HmiAlarm;
using Siemens.Engineering.HmiUnified.UI.Screens;
using Siemens.Engineering.HmiUnified.UI.Base;
using Siemens.Engineering.HmiUnified.UI.Widgets;
using Siemens.Engineering.HmiUnified.UI.Shapes;
using Siemens.Engineering.HmiUnified.UI.Dynamization;
using Newtonsoft.Json.Linq;

namespace PacForgeBridge
{
    /// <summary>
    /// WinCC Unified HMI generation via Openness (TIA V20). Driven by a JSON
    /// spec so the C# engine is built once and the HMI content is iterated as
    /// data. Every item is created in its own try/catch; the result reports
    /// per-section created / skipped / errors so a partial build is usable.
    /// </summary>
    public partial class TiaPortalService
    {
        public HmiSoftware GetHmiSoftware(string deviceName)
        {
            if (_project == null) throw new InvalidOperationException("No project open.");
            HmiSoftware fallback = null;
            foreach (Device d in _project.Devices)
            {
                HmiSoftware hmi = SearchHmi(d.DeviceItems);
                if (hmi == null) continue;
                if (!string.IsNullOrEmpty(deviceName) && d.Name == deviceName) return hmi;
                if (fallback == null) fallback = hmi;
            }
            if (fallback != null && string.IsNullOrEmpty(deviceName)) return fallback;
            if (fallback != null) return fallback; // name mismatch — use the one we found
            throw new InvalidOperationException($"No WinCC Unified HMI device found (looked for '{deviceName}').");
        }

        private HmiSoftware SearchHmi(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                var container = ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                if (container?.Software is HmiSoftware hmi) return hmi;
                var nested = SearchHmi(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        // set every language item of a MultilingualText to the same value
        private static void SetText(MultilingualText mlt, string value)
        {
            if (mlt == null || value == null) return;
            // Unified multilingual text is stored as XHTML
            string xhtml = value.TrimStart().StartsWith("<body")
                ? value
                : "<body><p>" + System.Security.SecurityElement.Escape(value) + "</p></body>";
            int n = 0;
            foreach (var it in mlt.Items) { it.Text = xhtml; n++; }
            if (n == 0) { try { mlt.Items[0].Text = xhtml; } catch { } }
        }

        // Read-only dump of the HMI structure (what the Template Suite wizard
        // created) so layout design is grounded in reality.
        public JObject InspectHmi(string deviceName)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");
            HmiSoftware hmi = GetHmiSoftware(deviceName);
            var result = new JObject { ["device"] = hmi.Name };

            var screens = new JArray();
            foreach (HmiScreen s in hmi.Screens)
                screens.Add(new JObject { ["name"] = s.Name, ["width"] = s.Width, ["height"] = s.Height,
                    ["items"] = s.ScreenItems.Count });
            result["screens"] = screens;

            var groups = new JArray();
            foreach (var g in hmi.ScreenGroups)
                groups.Add(DumpScreenGroup(g));
            result["screenGroups"] = groups;

            var conns = new JArray();
            foreach (HmiConnection c in hmi.Connections)
                conns.Add(new JObject { ["name"] = c.Name, ["partner"] = c.Partner, ["driver"] = c.CommunicationDriver });
            result["connections"] = conns;

            result["tagCount"] = hmi.Tags.Count;

            // per-tag detail: which connection each tag rides on and what PLC
            // tag it binds to — the debugging surface for "shows tag name
            // instead of value" (broken connection / lost PlcTag binding)
            var tags = new JArray();
            foreach (HmiTag t in hmi.Tags)
            {
                var jt = new JObject { ["name"] = t.Name };
                try { jt["connection"] = t.Connection; } catch { }
                try { jt["plcTag"] = t.PlcTag; } catch { }
                try { jt["dataType"] = t.DataType; } catch { }
                tags.Add(jt);
            }
            result["tags"] = tags;

            result["discreteAlarmCount"] = hmi.DiscreteAlarms.Count;
            var alarmClasses = new JArray();
            foreach (var ac in hmi.AlarmClasses) alarmClasses.Add(ac.Name);
            result["alarmClasses"] = alarmClasses;
            return result;
        }

        private JObject DumpScreenGroup(Siemens.Engineering.HmiUnified.UI.ScreenGroup.HmiScreenGroup g)
        {
            var jo = new JObject { ["name"] = g.Name };
            var screens = new JArray();
            foreach (HmiScreen s in g.Screens)
                screens.Add(new JObject { ["name"] = s.Name, ["width"] = s.Width, ["height"] = s.Height, ["items"] = s.ScreenItems.Count });
            jo["screens"] = screens;
            var sub = new JArray();
            foreach (var sg in g.Groups) sub.Add(DumpScreenGroup(sg));
            if (sub.Count > 0) jo["groups"] = sub;
            return jo;
        }

        // Recursive property-graph dump for diagnosing the Openness object
        // model (e.g. dynamization condition/"single bit" settings). Scalars
        // as strings, enumerables as arrays, objects recursed to `depth`.
        private JToken DumpObjectGraph(object o, int depth)
        {
            if (o == null) return JValue.CreateNull();
            var t = o.GetType();
            if (t.IsPrimitive || t.IsEnum || o is string || o is decimal || t.Name == "Color")
                return o.ToString();
            if (depth <= 0) return "(" + t.Name + ")";
            if (o is System.Collections.IEnumerable en && !(o is string))
            {
                var arr = new JArray();
                foreach (var child in en) arr.Add(DumpObjectGraph(child, depth - 1));
                return arr;
            }
            var jo = new JObject { ["__type"] = t.Name };
            foreach (var pi in t.GetProperties())
            {
                if (pi.GetIndexParameters().Length > 0) continue;
                if (pi.Name == "Parent") continue; // avoid cycles
                try
                {
                    var v = pi.GetValue(o);
                    if (v == null) continue;
                    jo[pi.Name] = DumpObjectGraph(v, depth - 1);
                }
                catch { }
            }
            return jo;
        }

        private HmiScreen FindScreenAnywhere(HmiSoftware hmi, string name)
        {
            var direct = hmi.Screens.Find(name);
            if (direct != null) return direct;
            HmiScreen FromGroup(Siemens.Engineering.HmiUnified.UI.ScreenGroup.HmiScreenGroup g)
            {
                var s = g.Screens.Find(name);
                if (s != null) return s;
                foreach (var sg in g.Groups) { var n = FromGroup(sg); if (n != null) return n; }
                return null;
            }
            foreach (var g in hmi.ScreenGroups) { var s = FromGroup(g); if (s != null) return s; }
            return null;
        }

        // Item-level dump of one screen: type, geometry, text, event summaries.
        public JObject InspectScreen(string deviceName, string screenName)
            => InspectScreen(deviceName, screenName, false);

        public JObject InspectScreen(string deviceName, string screenName, bool dumpProps)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");
            HmiSoftware hmi = GetHmiSoftware(deviceName);
            HmiScreen scr = FindScreenAnywhere(hmi, screenName)
                ?? throw new InvalidOperationException($"screen '{screenName}' not found");
            var items = new JArray();
            foreach (HmiScreenItemBase it in scr.ScreenItems)
            {
                var jo = new JObject { ["name"] = it.Name, ["type"] = it.GetType().Name };
                foreach (var p in new[] { "Left", "Top", "Width", "Height" })
                {
                    try { jo[p.ToLower()] = JToken.FromObject(it.GetAttribute(p)); } catch { }
                }
                foreach (var p in new[] { "StyleItemClass", "BackColor", "ForeColor", "BorderColor", "BorderWidth" })
                {
                    try { var v = it.GetAttribute(p); if (v != null && v.ToString() != "") jo[p] = v.ToString(); } catch { }
                }
                try
                {
                    var font = it.GetType().GetProperty("Font")?.GetValue(it);
                    if (font != null)
                        jo["font"] = (font.GetType().GetProperty("Name")?.GetValue(font) ?? "") + " " +
                                     (font.GetType().GetProperty("Size")?.GetValue(font) ?? "") + " " +
                                     (font.GetType().GetProperty("Weight")?.GetValue(font) ?? "");
                }
                catch { }
                try
                {
                    var textProp = it.GetType().GetProperty("Text");
                    if (textProp?.GetValue(it) is MultilingualText mlt)
                        foreach (var li in mlt.Items) { jo["text"] = li.Text; break; }
                }
                catch { }
                try
                {
                    var pv = it.GetType().GetProperty("ProcessValue")?.GetValue(it);
                    if (pv != null && pv.ToString() != "") jo["processValue"] = pv.ToString();
                }
                catch { }
                // full primitive-property dump (diagnostic): every readable
                // property whose value is a scalar — reveals the real bindable
                // value property of a control (e.g. what a ToggleSwitch uses)
                if (dumpProps)
                {
                    var props = new JObject();
                    foreach (var pi in it.GetType().GetProperties())
                    {
                        if (pi.GetIndexParameters().Length > 0) continue;
                        try
                        {
                            var v = pi.GetValue(it);
                            if (v == null) { props[pi.Name] = null; continue; }
                            var tp = v.GetType();
                            if (tp.IsPrimitive || tp.IsEnum || v is string || v is decimal)
                                props[pi.Name] = JToken.FromObject(v.ToString());
                        }
                        catch { }
                    }
                    jo["props"] = props;
                }
                try
                {
                    if (it.GetType().GetProperty("Dynamizations")?.GetValue(it) is System.Collections.IEnumerable dyns)
                    {
                        var da = new JArray();
                        foreach (var d in dyns)
                        {
                            var jd = new JObject { ["type"] = d.GetType().Name };
                            foreach (var pn in new[] { "PropertyName", "Tag", "ReadOnly" })
                                try { var v = d.GetType().GetProperty(pn)?.GetValue(d); if (v != null) jd[char.ToLower(pn[0]) + pn.Substring(1)] = JToken.FromObject(v); } catch { }
                            if (dumpProps)
                                jd["graph"] = DumpObjectGraph(d, 7);
                            da.Add(jd);
                        }
                        if (da.Count > 0) jo["dynamizations"] = da;
                    }
                }
                catch { }
                try
                {
                    var ehProp = it.GetType().GetProperty("EventHandlers");
                    if (ehProp?.GetValue(it) is System.Collections.IEnumerable evs)
                    {
                        var evArr = new JArray();
                        foreach (var ev in evs)
                        {
                            var evo = new JObject();
                            // dump every readable property; recurse one level into
                            // object-valued props (e.g. the script object)
                            foreach (var p in ev.GetType().GetProperties())
                            {
                                try
                                {
                                    var v = p.GetValue(ev);
                                    if (v == null || p.Name == "Parent") continue;
                                    if (v is string || v.GetType().IsValueType || v.GetType().IsEnum)
                                        evo[p.Name] = v.ToString();
                                    else
                                    {
                                        var sub = new JObject();
                                        foreach (var sp in v.GetType().GetProperties())
                                        {
                                            try
                                            {
                                                var sv = sp.GetValue(v);
                                                if (sv == null || sp.Name == "Parent") continue;
                                                if (sv is string || sv.GetType().IsValueType || sv.GetType().IsEnum)
                                                    sub[sp.Name] = sv.ToString();
                                            }
                                            catch { }
                                        }
                                        if (sub.Count > 0) evo[p.Name] = sub;
                                    }
                                }
                                catch { }
                            }
                            evArr.Add(evo);
                        }
                        if (evArr.Count > 0) jo["events"] = evArr;
                    }
                }
                catch { }
                items.Add(jo);
            }
            return new JObject { ["screen"] = scr.Name, ["width"] = scr.Width, ["height"] = scr.Height, ["items"] = items };
        }

        public JObject CompileHmi(string deviceName)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");
            // HmiSoftware has no GetService — compile via its owning DeviceItem
            DeviceItem hmiItem = null;
            void Search(DeviceItemComposition items)
            {
                foreach (DeviceItem item in items)
                {
                    var c = ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                    if (c?.Software is HmiSoftware) { hmiItem = item; return; }
                    Search(item.DeviceItems);
                    if (hmiItem != null) return;
                }
            }
            foreach (Device d in _project.Devices) { Search(d.DeviceItems); if (hmiItem != null) break; }
            if (hmiItem == null) throw new InvalidOperationException("HMI device item not found");
            var compiler = ((IEngineeringServiceProvider)hmiItem).GetService<Siemens.Engineering.Compiler.ICompilable>()
                ?? throw new InvalidOperationException("HMI software is not compilable via Openness");
            var result = compiler.Compile();
            var jo = new JObject { ["state"] = result.State.ToString(),
                ["warnings"] = result.WarningCount, ["errors"] = result.ErrorCount };
            var msgs = new JArray();
            void Walk(Siemens.Engineering.Compiler.CompilerResultMessage m, int depth)
            {
                if (m.State.ToString() != "Success" || depth == 0)
                    msgs.Add(new JObject { ["state"] = m.State.ToString(), ["path"] = m.Path, ["text"] = m.Description });
                foreach (var c in m.Messages) Walk(c, depth + 1);
            }
            foreach (var m in result.Messages) Walk(m, 0);
            jo["messages"] = msgs;
            return jo;
        }

        public JObject BuildHmi(JObject spec)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            var result = new JObject();
            var log = new JArray();
            void Log(string section, string name, bool ok, string msg)
                => log.Add(new JObject { ["section"] = section, ["item"] = name, ["ok"] = ok, ["msg"] = msg });

            string deviceName = (string)spec["device"] ?? "";
            HmiSoftware hmi = GetHmiSoftware(deviceName);
            result["device"] = hmi.Name;

            // ---- connection: reuse existing (wizard/template), else create ----
            string connName = (string)spec["connectionName"];
            HmiConnection conn = null;
            if (hmi.Connections.Count > 0)
            {
                // prefer a connection that actually has a partner PLC (an
                // orphaned placeholder may be undeletable but useless)
                conn = hmi.Connections.FirstOrDefault(c => !string.IsNullOrEmpty(c.Partner))
                    ?? hmi.Connections.First();
                connName = conn.Name;
                Log("connection", connName, true, $"reused existing connection (partner: {conn.Partner ?? "none"})");
            }
            else if (!string.IsNullOrEmpty(connName))
            {
                try
                {
                    conn = hmi.Connections.Create(connName);
                    conn.CommunicationDriver = (string)spec["driver"] ?? "Simatic S7 1500";
                    Log("connection", connName, true, "created (verify partner PLC in TIA — Openness can't set it)");
                }
                catch (Exception ex) { Log("connection", connName, false, ex.Message); }
            }
            result["connection"] = connName;

            // ---- delete screens (cleanup of superseded ones) ----
            foreach (var dn in (JArray)spec["deleteScreens"] ?? new JArray())
            {
                string name = (string)dn;
                try
                {
                    var scr = FindScreenAnywhere(hmi, name);
                    if (scr != null) { scr.Delete(); Log("deleteScreen", name, true, "deleted"); }
                    else Log("deleteScreen", name, true, "not present");
                }
                catch (Exception ex) { Log("deleteScreen", name, false, ex.Message); }
            }

            // ---- tags ----
            var tags = (JArray)spec["tags"] ?? new JArray();
            string tagTable = (string)spec["tagTable"];
            int tagOk = 0;
            foreach (var t in tags)
            {
                string name = (string)t["name"];
                try
                {
                    HmiTag tag = hmi.Tags.Find(name)
                        ?? (string.IsNullOrEmpty(tagTable) ? hmi.Tags.Create(name) : hmi.Tags.Create(name, tagTable));
                    // internal tag: no PLC connection — HMI-local scratch storage
                    // (e.g. a UI "armed" flag). Leave Connection unset so WinCC
                    // keeps it internal; set DataType + optional InitialValue.
                    if ((bool?)t["internal"] == true)
                    {
                        try { tag.DataType = (string)t["dataType"]; } catch { }
                        try { if (t["initial"] != null) tag.InitialValue = (string)t["initial"]; } catch { }
                        tagOk++;
                        Log("tag", name, true, "internal " + (string)t["dataType"]);
                        continue;
                    }
                    // field-by-field: with a partnered connection WinCC derives
                    // DataType (and more) from the PLC tag — those fields go
                    // read-only, so set only what's settable.
                    try { if (!string.IsNullOrEmpty(connName)) tag.Connection = connName; } catch { }
                    tag.PlcTag = (string)t["plcTag"];
                    try { if (string.IsNullOrEmpty((string)t["plcTag"])) tag.DataType = (string)t["dataType"]; } catch { }
                    var lin = t["linear"];
                    if (lin != null)
                    {
                        tag.LinearScaling = true;
                        tag.PlcStartValue = (double)lin["plcStart"];
                        tag.PlcEndValue = (double)lin["plcEnd"];
                        tag.HmiStartValue = (double)lin["hmiStart"];
                        tag.HmiEndValue = (double)lin["hmiEnd"];
                    }
                    tagOk++;
                    Log("tag", name, true, tag.PlcTag);
                }
                catch (Exception ex) { Log("tag", name, false, ex.Message); }
            }
            result["tagsCreated"] = tagOk;

            // ---- alarm classes (G8-2) ----
            // Created BEFORE alarms so the alarms section's existing
            // "assign only if the class exists" guard now finds them.
            // API verified against the V20 Openness catalogue:
            // HmiAlarmClassComposition.Create(string)/Find(string);
            // HmiAlarmClass.StateMachine : HmiAlarmStateMachine.
            foreach (var c in (JArray)spec["alarmClasses"] ?? new JArray())
            {
                string cname = (string)c["name"];
                try
                {
                    var cls = hmi.AlarmClasses.Find(cname) ?? hmi.AlarmClasses.Create(cname);
                    if (c["acknowledgement"] != null)
                        cls.StateMachine = (bool)c["acknowledgement"]
                            ? Siemens.Engineering.HmiUnified.HmiAlarm.HmiAlarmCommon.HmiAlarmStateMachine.RaiseClearRequiresAcknowledgement
                            : Siemens.Engineering.HmiUnified.HmiAlarm.HmiAlarmCommon.HmiAlarmStateMachine.RaiseClear;
                    Log("alarmClass", cname, true, cls.StateMachine.ToString());
                }
                catch (Exception ex) { Log("alarmClass", cname, false, ex.Message); }
            }

            // ---- delete alarms ----
            foreach (var dn in (JArray)spec["deleteAlarms"] ?? new JArray())
            {
                string name = (string)dn;
                try
                {
                    var alm = hmi.DiscreteAlarms.Find(name);
                    if (alm != null) { alm.Delete(); Log("deleteAlarm", name, true, "deleted"); }
                    else Log("deleteAlarm", name, true, "not present");
                }
                catch (Exception ex) { Log("deleteAlarm", name, false, ex.Message); }
            }

            // ---- alarms ----
            var alarms = (JArray)spec["alarms"] ?? new JArray();
            int almOk = 0;
            foreach (var a in alarms)
            {
                string name = (string)a["name"];
                try
                {
                    HmiDiscreteAlarm alm = hmi.DiscreteAlarms.Find(name) ?? hmi.DiscreteAlarms.Create(name);
                    alm.RaisedStateTag = (string)a["tag"];
                    if (a["trigger"] != null)
                        alm.TriggerMode = (Siemens.Engineering.HmiUnified.HmiAlarm.HmiAlarmCommon.HmiDiscreteAlarmTriggerMode)
                            Enum.Parse(typeof(Siemens.Engineering.HmiUnified.HmiAlarm.HmiAlarmCommon.HmiDiscreteAlarmTriggerMode), (string)a["trigger"], true);
                    if (a["bit"] != null) alm.RaisedStateTagBitNumber = (uint)(int)a["bit"];
                    string cls = (string)a["class"];
                    if (!string.IsNullOrEmpty(cls) && hmi.AlarmClasses.Find(cls) != null) alm.AlarmClass = cls;
                    if (a["priority"] != null) alm.Priority = (byte)(int)a["priority"];
                    SetText(alm.EventText, (string)a["text"]);
                    almOk++;
                    Log("alarm", name, true, cls);
                }
                catch (Exception ex) { Log("alarm", name, false, ex.Message); }
            }
            result["alarmsCreated"] = almOk;

            // ---- screens ----
            var screens = (JArray)spec["screens"] ?? new JArray();
            int scrOk = 0, itemOk = 0;
            foreach (var s in screens)
            {
                string sname = (string)s["name"];
                try
                {
                    HmiScreen scr = FindScreenAnywhere(hmi, sname);
                    if (scr == null)
                    {
                        string groupName = (string)s["group"];
                        if (!string.IsNullOrEmpty(groupName))
                        {
                            var grp = FindGroup(hmi, groupName)
                                ?? throw new InvalidOperationException($"screen group '{groupName}' not found");
                            scr = grp.Screens.Create(sname);
                        }
                        else scr = hmi.Screens.Create(sname);
                    }
                    if (s["width"] != null) scr.Width = (uint)(int)s["width"];
                    if (s["height"] != null) scr.Height = (uint)(int)s["height"];
                    if (s["backColor"] != null) scr.BackColor = ParseHtmlColor((string)s["backColor"]);
                    if ((bool?)s["clear"] == true)
                    {
                        var toDelete = scr.ScreenItems.Cast<HmiScreenItemBase>().ToList();
                        foreach (var old in toDelete) { try { old.Delete(); } catch { } }
                    }
                    scrOk++;
                    foreach (var it in (JArray)s["items"] ?? new JArray())
                    {
                        string iname = (string)it["name"];
                        try { BuildItem(scr, it); itemOk++; Log("item", $"{sname}.{iname}", true, (string)it["type"]); }
                        catch (Exception ex) { Log("item", $"{sname}.{iname}", false, ex.Message); }
                    }
                    Log("screen", sname, true, $"{((JArray)s["items"])?.Count ?? 0} items");
                }
                catch (Exception ex) { Log("screen", sname, false, ex.Message); }
            }
            result["screensCreated"] = scrOk;
            result["screenItemsCreated"] = itemOk;

            // ---- edit existing items (e.g. template nav button scripts) ----
            foreach (var e in (JArray)spec["editItems"] ?? new JArray())
            {
                string sname = (string)e["screen"], iname = (string)e["item"];
                try
                {
                    var scr = FindScreenAnywhere(hmi, sname)
                        ?? throw new InvalidOperationException($"screen '{sname}' not found");
                    var item = scr.ScreenItems.Find(iname)
                        ?? throw new InvalidOperationException($"item '{iname}' not found");
                    if (e["event"] != null)
                        SetItemEventScript(item, (string)e["event"], (string)e["script"], (string)e["globalScript"]);
                    // remove dynamizations by property name (e.g. to move a
                    // binding from one property to another)
                    foreach (var rd in (JArray)e["removeDynamizations"] ?? new JArray())
                    {
                        string propName = (string)rd;
                        if (item.GetType().GetProperty("Dynamizations")?.GetValue(item) is System.Collections.IEnumerable dyns)
                        {
                            object victim = null;
                            foreach (var d in dyns)
                            {
                                var pn = d.GetType().GetProperty("PropertyName")?.GetValue(d)?.ToString();
                                if (string.Equals(pn, propName, StringComparison.OrdinalIgnoreCase)) { victim = d; break; }
                            }
                            if (victim != null)
                                victim.GetType().GetMethod("Delete")?.Invoke(victim, null);
                        }
                    }
                    ApplyDynamizations(item, e);
                    foreach (var prop in (JObject)e["set"] ?? new JObject())
                    {
                        // Text/AlternateText/Content are MultilingualText (XHTML
                        // per language), not scalars — SetAttribute would fail.
                        // Route them through the multilingual-text helper.
                        var piMlt = item.GetType().GetProperty(prop.Key);
                        if (piMlt != null && piMlt.PropertyType.Name == "MultilingualText")
                        {
                            if (piMlt.GetValue(item) is MultilingualText mlt) SetText(mlt, (string)prop.Value);
                            continue;
                        }
                        // JSON numbers arrive as Int64; Openness setters are
                        // strictly typed (Left:Int32, Width:UInt32, ...) —
                        // coerce to the CLR property's type when we can see it
                        object val = prop.Value.ToObject<object>();
                        var pi = item.GetType().GetProperty(prop.Key);
                        if (pi != null && val != null && pi.PropertyType.Name == "Color" && val is string html)
                            val = ParseHtmlColor(html);
                        else if (pi != null && val != null && !pi.PropertyType.IsEnum)
                        {
                            try { val = Convert.ChangeType(val, Nullable.GetUnderlyingType(pi.PropertyType) ?? pi.PropertyType); }
                            catch { }
                        }
                        ((IEngineeringObject)item).SetAttribute(prop.Key, val);
                    }
                    Log("editItem", $"{sname}.{iname}", true, (string)e["event"] ?? "props");
                }
                catch (Exception ex) { Log("editItem", $"{sname}.{iname}", false, ex.Message); }
            }

            SaveProject();
            result["log"] = log;
            result["errors"] = log.Count(x => !(bool)x["ok"]);
            return result;
        }

        private Siemens.Engineering.HmiUnified.UI.ScreenGroup.HmiScreenGroup FindGroup(HmiSoftware hmi, string name)
        {
            Siemens.Engineering.HmiUnified.UI.ScreenGroup.HmiScreenGroup FromGroup(Siemens.Engineering.HmiUnified.UI.ScreenGroup.HmiScreenGroup g)
            {
                if (g.Name == name) return g;
                foreach (var sg in g.Groups) { var n = FromGroup(sg); if (n != null) return n; }
                return null;
            }
            foreach (var g in hmi.ScreenGroups) { var f = FromGroup(g); if (f != null) return f; }
            return null;
        }

        // Type-agnostic event-script setter: find/create the handler whose
        // EventType matches, then set Script.ScriptCode.
        private void SetItemEventScript(object item, string eventTypeName, string script)
            => SetItemEventScript(item, eventTypeName, script, null);

        private void SetItemEventScript(object item, string eventTypeName, string script, string globalScript)
        {
            var ehProp = item.GetType().GetProperty("EventHandlers")
                ?? throw new InvalidOperationException($"{item.GetType().Name} has no EventHandlers");
            var comp = ehProp.GetValue(item);
            object handler = null;
            foreach (var h in (System.Collections.IEnumerable)comp)
            {
                var et = h.GetType().GetProperty("EventType")?.GetValue(h)?.ToString();
                if (string.Equals(et, eventTypeName, StringComparison.OrdinalIgnoreCase)) { handler = h; break; }
            }
            if (handler == null)
            {
                var create = comp.GetType().GetMethod("Create");
                var enumType = create.GetParameters()[0].ParameterType;
                handler = create.Invoke(comp, new[] { Enum.Parse(enumType, eventTypeName, true) });
            }
            var scriptObj = handler.GetType().GetProperty("Script")?.GetValue(handler)
                ?? throw new InvalidOperationException("handler has no Script");
            ((IEngineeringObject)scriptObj).SetAttribute("ScriptCode", script);
            try { ((IEngineeringObject)scriptObj).SetAttribute("Async", true); } catch { }
            if (globalScript != null)
                try { ((IEngineeringObject)scriptObj).SetAttribute("GlobalDefinitionAreaScriptCode", globalScript); } catch { }
        }

        private static System.Drawing.Color ParseHtmlColor(string html)
            => System.Drawing.ColorTranslator.FromHtml(html);

        private void ApplyCommon(object e, JToken it)
        {
            // geometry + colors + font size via reflection-free casts where possible
            void Set(string prop, object val)
            {
                var p = e.GetType().GetProperty(prop);
                if (p != null && p.CanWrite) p.SetValue(e, val);
            }
            Set("Left", (int?)it["left"] ?? 0);
            Set("Top", (int?)it["top"] ?? 0);
            Set("Width", (uint)((int?)it["width"] ?? 120));
            Set("Height", (uint)((int?)it["height"] ?? 30));
            if (it["backColor"] != null) Set("BackColor", ParseHtmlColor((string)it["backColor"]));
            if (it["foreColor"] != null) Set("ForeColor", ParseHtmlColor((string)it["foreColor"]));
            if (it["fontSize"] != null || it["bold"] != null)
            {
                try
                {
                    var font = e.GetType().GetProperty("Font")?.GetValue(e);
                    if (font != null)
                    {
                        if (it["fontSize"] != null) font.GetType().GetProperty("Size")?.SetValue(font, (float)(double)it["fontSize"]);
                        font.GetType().GetProperty("Name")?.SetValue(font, "SiemensSans");
                        if ((bool?)it["bold"] == true)
                        {
                            var wp = font.GetType().GetProperty("Weight");
                            if (wp != null) wp.SetValue(font, Enum.Parse(wp.PropertyType, "Bold", true));
                        }
                    }
                }
                catch { }
            }
            // events: [{ "event": "Tapped"|"Down"|"Up", "script": "..." }]
            foreach (var ev in (JArray)it["events"] ?? new JArray())
                SetItemEventScript(e, (string)ev["event"], (string)ev["script"]);
            // dynamizations: [{ "property": "IsAlternateState", "tag": "X", "readOnly": false }]
            ApplyDynamizations(e, it);
        }

        // Create-or-update a TagDynamization per entry; reuses an existing
        // dynamization on the same property so repeat runs are idempotent.
        private void ApplyDynamizations(object e, JToken it)
        {
            foreach (var dy in (JArray)it["dynamizations"] ?? new JArray())
            {
                string propName = (string)dy["property"];
                var dynComp = e.GetType().GetProperty("Dynamizations")?.GetValue(e)
                    ?? throw new InvalidOperationException("no Dynamizations composition");
                TagDynamization dyn = null;
                foreach (var d in (System.Collections.IEnumerable)dynComp)
                {
                    var pn = d.GetType().GetProperty("PropertyName")?.GetValue(d)?.ToString();
                    if (string.Equals(pn, propName, StringComparison.OrdinalIgnoreCase) && d is TagDynamization td)
                    {
                        dyn = td;
                        break;
                    }
                }
                if (dyn == null)
                {
                    var createT = dynComp.GetType().GetMethods()
                        .First(m => m.Name == "Create" && m.IsGenericMethod);
                    dyn = (TagDynamization)createT.MakeGenericMethod(typeof(TagDynamization))
                        .Invoke(dynComp, new object[] { propName });
                }
                dyn.Tag = (string)dy["tag"];
                if (dy["readOnly"] != null) dyn.ReadOnly = (bool)dy["readOnly"];

                // singleBit: { "off": "#CDD3D7", "on": "#00FF00" } — configures
                // the ValueConverter mapping table the way the editor's
                // "Single bit" condition type does. Without it a Bool->color
                // dynamization maps nothing and the color never changes.
                var sb = dy["singleBit"];
                if (sb != null)
                    ConfigureSingleBitMapping(dyn, (string)sb["off"], (string)sb["on"]);
            }
        }

        private void ConfigureSingleBitMapping(TagDynamization dyn, string offHtml, string onHtml)
        {
            var conv = dyn.GetType().GetProperty("ValueConverter")?.GetValue(dyn)
                ?? throw new InvalidOperationException("dynamization has no ValueConverter");
            var table = conv.GetType().GetProperty("MappingTable")?.GetValue(conv)
                ?? throw new InvalidOperationException("ValueConverter has no MappingTable");

            // ConditionType = Singlebit
            var ctProp = table.GetType().GetProperty("ConditionType")
                ?? throw new InvalidOperationException("MappingTable has no ConditionType");
            ctProp.SetValue(table, Enum.Parse(ctProp.PropertyType, "Singlebit", true));

            var entriesProp = table.GetType().GetProperty("Entries")?.GetValue(table)
                ?? throw new InvalidOperationException("MappingTable has no Entries");

            // collect existing entries by their Condition value; create the
            // missing ones via the composition's Create method
            var byCondition = new Dictionary<string, object>();
            foreach (var e in (System.Collections.IEnumerable)entriesProp)
            {
                var c = e.GetType().GetProperty("Condition")?.GetValue(e)?.ToString();
                if (c != null && !byCondition.ContainsKey(c)) byCondition[c] = e;
            }
            object EntryFor(string condition)
            {
                if (byCondition.TryGetValue(condition, out var existing)) return existing;
                var create = entriesProp.GetType().GetMethods()
                    .First(m => m.Name == "Create" && m.GetParameters().Length == 0);
                var fresh = create.Invoke(entriesProp, null);
                byCondition[condition] = fresh;
                return fresh;
            }
            void Configure(object entry, string condition, string html)
            {
                void Set(string prop, object val)
                {
                    var pi = entry.GetType().GetProperty(prop);
                    if (pi == null || !pi.CanWrite) return;
                    if (pi.PropertyType.IsEnum && val is string s) val = Enum.Parse(pi.PropertyType, s, true);
                    else if (pi.PropertyType.Name != "Color") { try { val = Convert.ChangeType(val, pi.PropertyType); } catch { } }
                    pi.SetValue(entry, val);
                }
                Set("BitDynamizationType", "SingleBit");
                Set("Condition", condition);
                Set("Relevant", 1);
                Set("Flashing", false);
                Set("Value", ParseHtmlColor(html));
            }
            Configure(EntryFor("0"), "0", offHtml);
            Configure(EntryFor("1"), "1", onHtml);
        }

        private void BuildItem(HmiScreen scr, JToken it)
        {
            string type = (string)it["type"];
            string name = (string)it["name"];
            string tag = (string)it["tag"];
            string text = (string)it["text"];

            switch (type)
            {
                case "Label":  // HmiLabel unsupported on Unified Basic panels -> HmiText
                    {
                        var e = scr.ScreenItems.Create<HmiText>(name);
                        ApplyCommon(e, it); SetText(e.Text, text);
                        break;
                    }
                case "Text":
                    {
                        var e = scr.ScreenItems.Create<HmiText>(name);
                        ApplyCommon(e, it); SetText(e.Text, text);
                        break;
                    }
                case "Rectangle":
                    {
                        var e = scr.ScreenItems.Create<HmiRectangle>(name);
                        ApplyCommon(e, it);
                        break;
                    }
                case "IOField":
                    {
                        var e = scr.ScreenItems.Create<HmiIOField>(name);
                        ApplyCommon(e, it);
                        // static ProcessValue would just display the tag NAME —
                        // the value binding must be a Tag dynamization
                        if (!string.IsNullOrEmpty(tag))
                        {
                            var dyn = e.Dynamizations.Create<TagDynamization>("ProcessValue");
                            dyn.Tag = tag;
                            dyn.ReadOnly = false;
                        }
                        if (it["mode"] != null)
                            e.IOFieldType = (Siemens.Engineering.HmiUnified.UI.Enum.HmiIOFieldType)
                                Enum.Parse(typeof(Siemens.Engineering.HmiUnified.UI.Enum.HmiIOFieldType), (string)it["mode"], true);
                        if (it["format"] != null) e.OutputFormat = (string)it["format"];
                        break;
                    }
                case "Button":
                    {
                        var e = scr.ScreenItems.Create<HmiButton>(name);
                        ApplyCommon(e, it); SetText(e.Text, text);
                        break;
                    }
                case "ToggleSwitch":
                    {
                        var e = scr.ScreenItems.Create<HmiToggleSwitch>(name);
                        ApplyCommon(e, it); SetText(e.Text, text);
                        if (!string.IsNullOrEmpty(tag))
                        {
                            var dyn = e.Dynamizations.Create<TagDynamization>("IsAlternateState");
                            dyn.Tag = tag; dyn.ReadOnly = false;
                        }
                        break;
                    }
                case "Circle":
                    {
                        var e = scr.ScreenItems.Create<HmiCircle>(name);
                        // circles position by center + radius
                        int l = (int?)it["left"] ?? 0, t = (int?)it["top"] ?? 0;
                        int r = (int?)it["radius"] ?? 8;
                        e.CenterX = l + r; e.CenterY = t + r; e.Radius = (uint)r;
                        if (it["backColor"] != null) e.BackColor = ParseHtmlColor((string)it["backColor"]);
                        // lamp "on" colour: shown when the AlternateBackColor
                        // dynamization's bool tag is TRUE (template lamp pattern)
                        if (it["alternateBackColor"] != null)
                        {
                            try { ((IEngineeringObject)e).SetAttribute("AlternateBackColor", ParseHtmlColor((string)it["alternateBackColor"])); } catch { }
                        }
                        ApplyDynamizations(e, it);
                        break;
                    }
                default:
                    throw new InvalidOperationException($"unknown item type '{type}'");
            }
        }
    }
}
#endif
