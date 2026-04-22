using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using Siemens.Engineering;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;

namespace PacForgeBridge
{
    // ============================================================
    // Pac-Audit: Cross-reference extraction
    //
    // Productionised from the V3 spike (TiaPortalService.AuditSpike.cs). Per-block walk
    // only — bulk enumeration at PlcSoftware/BlockGroup/Project level returns null on V18
    // (confirmed by spike, see PAC_AUDIT_DERIVED_SPEC.md §12.0).
    //
    // Reflection-based to survive V18/V20 API drift without a reference-assembly rebuild.
    // The types Siemens.Engineering.CrossReference.CrossReferenceService etc. exist in
    // the Openness DLL but are not imported via `using` — we resolve them at runtime.
    // ============================================================
    public partial class TiaPortalService
    {
        /// <summary>
        /// Walks each block's CrossReferenceService and flattens the Source → Reference → Location
        /// tree into DTOs. One row per occurrence. Per-block failures become warnings and do not
        /// abort the overall extract.
        /// </summary>
        private List<ExtractedCrossReferenceDto> ExtractCrossReferences(
            PlcSoftware plcSoftware,
            List<PlcBlock> allBlocks,
            List<string> warnings)
        {
            var result = new List<ExtractedCrossReferenceDto>();
            if (plcSoftware == null || allBlocks == null || allBlocks.Count == 0)
                return result;

            Type svcType = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceService");
            Type filterEnum = FindTypeByName("Siemens.Engineering.CrossReference.CrossReferenceFilter");
            if (svcType == null || filterEnum == null)
            {
                warnings.Add("Cross-references: CrossReferenceService or CrossReferenceFilter type not found in the Openness assembly — skipping xref extraction");
                return result;
            }

            MethodInfo getServiceGeneric = typeof(IEngineeringServiceProvider)
                .GetMethods()
                .FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);
            if (getServiceGeneric == null)
            {
                warnings.Add("Cross-references: IEngineeringServiceProvider.GetService<T>() not found — skipping");
                return result;
            }

            MethodInfo genericGetService = getServiceGeneric.MakeGenericMethod(svcType);
            MethodInfo getRefsMethod = svcType.GetMethods().FirstOrDefault(m => m.Name == "GetCrossReferences");
            if (getRefsMethod == null)
            {
                warnings.Add("Cross-references: CrossReferenceService.GetCrossReferences method not found — skipping");
                return result;
            }

            object filterAllObjects;
            try { filterAllObjects = Enum.Parse(filterEnum, "AllObjects"); }
            catch (Exception ex)
            {
                warnings.Add($"Cross-references: CrossReferenceFilter.AllObjects not available ({ex.Message}) — skipping");
                return result;
            }

            int blocksProcessed = 0;
            int blocksSkipped = 0;
            int rowsEmitted = 0;
            var sw = Stopwatch.StartNew();

            foreach (PlcBlock block in allBlocks)
            {
                blocksProcessed++;
                string blockName = null;
                try { blockName = block.Name; } catch { }

                try
                {
                    object svc;
                    try { svc = genericGetService.Invoke(block, null); }
                    catch (Exception inner)
                    {
                        warnings.Add($"Cross-references: GetService<CrossReferenceService>() failed on block '{blockName}': {inner.InnerException?.Message ?? inner.Message}");
                        blocksSkipped++;
                        continue;
                    }

                    if (svc == null)
                    {
                        blocksSkipped++;
                        continue;
                    }

                    object xrefResult;
                    try { xrefResult = getRefsMethod.Invoke(svc, new object[] { filterAllObjects }); }
                    catch (Exception inner)
                    {
                        warnings.Add($"Cross-references: GetCrossReferences() threw on block '{blockName}': {inner.InnerException?.Message ?? inner.Message}");
                        blocksSkipped++;
                        continue;
                    }

                    if (xrefResult == null) { blocksSkipped++; continue; }

                    int emittedForBlock = FlattenCrossRefResult(xrefResult, result);
                    rowsEmitted += emittedForBlock;
                }
                catch (Exception ex)
                {
                    warnings.Add($"Cross-references: unexpected error on block '{blockName}': {ex.Message}");
                    blocksSkipped++;
                }

                if (blocksProcessed % 50 == 0)
                {
                    Console.WriteLine($"[Audit xref] {blocksProcessed}/{allBlocks.Count} blocks, {rowsEmitted} rows so far ({sw.Elapsed.TotalSeconds:F1}s)");
                }
            }

            sw.Stop();
            Console.WriteLine($"[Audit xref] done: {rowsEmitted} rows from {blocksProcessed - blocksSkipped}/{allBlocks.Count} blocks ({blocksSkipped} skipped) in {sw.Elapsed.TotalSeconds:F1}s");

            return result;
        }

        /// <summary>
        /// Flattens a CrossReferenceResult into DTO rows. Expects result.Sources enumerable of
        /// SourceObject; each source has References enumerable of ReferenceObject; each ref has
        /// Locations enumerable of Location. Returns the number of rows appended.
        /// </summary>
        private int FlattenCrossRefResult(object xrefResult, List<ExtractedCrossReferenceDto> sink)
        {
            int emitted = 0;
            IEnumerable sources = GetEnumerableProperty(xrefResult, "Sources");
            if (sources == null) return 0;

            foreach (object src in sources)
            {
                if (src == null) continue;

                string sourceName = GetStringProp(src, "Name");
                string sourcePath = GetStringProp(src, "Path");
                string sourceAddress = GetStringProp(src, "Address");
                string sourceTypeName = GetStringProp(src, "TypeName");
                string sourceDevice = GetStringProp(src, "Device");

                IEnumerable refs = GetEnumerableProperty(src, "References");
                if (refs == null) continue;

                foreach (object refObj in refs)
                {
                    if (refObj == null) continue;

                    string targetName = GetStringProp(refObj, "Name");
                    string targetPath = GetStringProp(refObj, "Path");
                    string targetAddress = GetStringProp(refObj, "Address");
                    string targetTypeName = GetStringProp(refObj, "TypeName");
                    string targetDevice = GetStringProp(refObj, "Device");

                    IEnumerable locs = GetEnumerableProperty(refObj, "Locations");
                    if (locs == null) continue;

                    foreach (object loc in locs)
                    {
                        if (loc == null) continue;

                        sink.Add(new ExtractedCrossReferenceDto
                        {
                            SourceName = sourceName,
                            SourcePath = sourcePath,
                            SourceAddress = sourceAddress,
                            SourceTypeName = sourceTypeName,
                            SourceDevice = sourceDevice,

                            TargetName = targetName,
                            TargetPath = targetPath,
                            TargetAddress = targetAddress,
                            TargetTypeName = targetTypeName,
                            TargetDevice = targetDevice,

                            Access = GetStringProp(loc, "Access"),
                            ReferenceType = GetStringProp(loc, "ReferenceType"),
                            ReferenceLocation = GetStringProp(loc, "ReferenceLocation"),
                            ReferencedAsName = GetStringProp(loc, "ReferencedAsName"),
                            LocationAddress = GetStringProp(loc, "Address"),
                            LocationName = GetStringProp(loc, "Name"),
                            LocationTypeName = GetStringProp(loc, "TypeName"),
                        });
                        emitted++;
                    }
                }
            }

            return emitted;
        }

        private static IEnumerable GetEnumerableProperty(object obj, string propName)
        {
            if (obj == null) return null;
            try
            {
                var prop = obj.GetType().GetProperty(propName);
                if (prop == null) return null;
                return prop.GetValue(obj) as IEnumerable;
            }
            catch { return null; }
        }

        private static string GetStringProp(object obj, string propName)
        {
            if (obj == null) return null;
            try
            {
                var prop = obj.GetType().GetProperty(propName);
                if (prop == null) return null;
                return prop.GetValue(obj)?.ToString();
            }
            catch { return null; }
        }
    }
}
