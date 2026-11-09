using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using Newtonsoft.Json;
#if TIA_V21
using Siemens.Engineering;
using Siemens.Engineering.CrossReference;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.Online;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;
#endif

namespace PacForgeBridge
{
    public sealed class BlockDeleteRequest
    {
        public bool dry_run = true;
        public string expected_project_path, plc_name, control_block, control_caller, plan_id;
        public bool confirm_delete, require_code_memory_fit;
        public List<DeleteBlockIdentity> blocks;
    }
    public partial class TiaPortalService
    {
        // HTTP operations and queued jobs share this gate. Never hold it for a WebSocket session.
        internal readonly SemaphoreSlim OperationGate = new SemaphoreSlim(1,1);

        public object DeleteUnusedBlocks(BlockDeleteRequest request)
        {
#if !TIA_V21
            throw new InvalidOperationException("Unused-block deletion is qualified only for TIA V21. Nothing was changed.");
#else
            if(request==null) throw new InvalidOperationException("A block-delete request is required.");
            if(!EnsureProjectFresh()) throw new InvalidOperationException("Open the isolated offline working project first.");
            using(_tiaPortal.ExclusiveAccess("Preview/apply unused standard-block deletion; no PLC download"))
            {
                ValidateDeleteContext(request.expected_project_path,request.plc_name);
                if(request.dry_run) return PreviewBlockDelete(request);
                return ApplyBlockDelete(request);
            }
#endif
        }
#if TIA_V21
        private sealed class DeletePlan
        {
            internal string Id, Project, Plc, Control, Caller, Inventory;
            internal DateTime Expires;
            internal bool RequireMemoryFit;
            internal List<DeleteBlockIdentity> Targets;
        }
        private DeletePlan _deletePlan;
        private PlcSoftware DeletePlc()
        {
            return DeleteCpus().Single().GetService<SoftwareContainer>().Software as PlcSoftware;
        }
        private List<DeviceItem> DeleteCpus()
        {
            var cpus=new List<DeviceItem>();
            foreach(var device in DeleteDevices().Distinct()) CollectDeleteCpus(device.DeviceItems,cpus);
            if(cpus.Count!=1) throw new InvalidOperationException("Expected exactly one PLC across all project device groups.");
            return cpus;
        }
        private IEnumerable<Device> DeleteDevices()
        {
            foreach(var device in _project.Devices) yield return device;
            foreach(var device in _project.UngroupedDevicesGroup.Devices) yield return device;
            foreach(var group in _project.DeviceGroups)
                foreach(var device in DeleteGroupDevices(group)) yield return device;
        }
        private static IEnumerable<Device> DeleteGroupDevices(DeviceUserGroup group)
        {
            foreach(var device in group.Devices) yield return device;
            foreach(var child in group.Groups)
                foreach(var device in DeleteGroupDevices(child)) yield return device;
        }

        private void ValidateDeleteContext(string project,string plc)
        {
            if(String.IsNullOrWhiteSpace(project) || !Path.IsPathRooted(project) || String.IsNullOrWhiteSpace(plc) ||
                !String.Equals(Path.GetFullPath(project),_project.Path.FullName,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Exact expected project path and PLC name are required.");
            // Ambiguous multi-PLC projects are deliberately outside this first bounded capability.
            var cpu=DeleteCpus().Single();
            if(((PlcSoftware)cpu.GetService<SoftwareContainer>().Software).Name!=plc) throw new InvalidOperationException("Expected exactly one PLC matching plc_name.");
            var online=cpu.GetService<OnlineProvider>();
            if(online==null || online.State!=OnlineState.Offline) throw new InvalidOperationException("TIA must be offline; connection state was not changed.");
            if(_project.IsModified) throw new InvalidOperationException("Save or discard existing engineer edits before preview/apply; this route will not save them.");
        }
        private static void CollectDeleteCpus(DeviceItemComposition items,List<DeviceItem> cpus)
        {
            foreach(var item in items)
            {
                var c=item.GetService<SoftwareContainer>();
                if(c!=null && c.Software is PlcSoftware) cpus.Add(item);
                CollectDeleteCpus(item.DeviceItems,cpus);
            }
        }
        private static DeleteBlockIdentity DeleteIdentity(PlcSoftware plc,PlcBlock b)
        {
            var folders=new List<string>();var g=b.Parent as PlcBlockGroup;
            while(g!=null) {folders.Insert(0,g.Name);g=g.Parent as PlcBlockGroup;}
            return new DeleteBlockIdentity {name=b.Name,number=b.Number,kind=b is FB?"FB":b is FC?"FC":b is OB?"OB":"DB",
                folder=plc.Name+"\\"+String.Join("\\",folders),language=b.ProgrammingLanguage.ToString(),consistent=b.IsConsistent,
                work_bytes=Convert.ToInt64(b.WorkMemoryLength)};
        }
        private List<PlcBlock> DeleteBlocks(PlcSoftware plc)
        {
            var list=new List<PlcBlock>();CollectBlocks(plc.BlockGroup,list);
            foreach(var system in plc.BlockGroup.SystemBlockGroups) DeleteSystemBlocks(system,list);
            return list;
        }
        private static void DeleteSystemBlocks(PlcSystemBlockGroup group,List<PlcBlock> list)
        {
            foreach(var b in group.Blocks) list.Add(b);
            foreach(var child in group.Groups) DeleteSystemBlocks(child,list);
        }
        private static string DeleteInventory(PlcSoftware plc,IEnumerable<PlcBlock> blocks)
        {
            // Excludes volatile consistency flags but binds the complete user-block identity inventory.
            return String.Join("\n",blocks.Select(b=>{var m=DeleteIdentity(plc,b);return m.folder+"|"+m.name+"|"+m.kind+"|"+m.number+"|"+m.language;}).OrderBy(s=>s,StringComparer.Ordinal));
        }
        private static PlcBlock DeleteFind(List<PlcBlock> blocks,string name)
        {
            var matches=blocks.Where(b=>b.Name==name).ToList();
            if(matches.Count!=1) throw new InvalidOperationException("Missing/ambiguous user block: "+name);
            if(!(matches[0].Parent is PlcBlockGroup)) throw new InvalidOperationException("System blocks are not eligible.");
            return matches[0];
        }
        // Text only: never navigate ReferenceObject.UnderlyingObject (known V21 host crash).
        private static DeleteReferenceSource DeleteSource(SourceObject s)
        {
            return new DeleteReferenceSource {name=s.Name,address=s.Address,path=s.Path,type=s.TypeName,
                children=s.Children.Select(DeleteSource).ToList(),references=s.References.Select(r=>new DeleteReference {
                    name=r.Name,locations=r.Locations.Select(l=>new DeleteReferenceLocation {relation=l.ReferenceType.ToString(),access=l.Access.ToString()}).ToList()}).ToList()};
        }
        private static List<DeleteReferenceSource> DeleteReferences(PlcBlock b)
        {
            if(!b.IsConsistent) throw new InvalidOperationException("Inconsistent block: "+b.Name);
            var service=b.GetService<CrossReferenceService>();
            if(service==null) throw new InvalidOperationException("Missing native reference service: "+b.Name);
            return service.GetCrossReferences(CrossReferenceFilter.AllObjects).Sources.Select(DeleteSource).ToList();
        }
        private static string DeleteExport(PlcBlock b,string folder,string file)
        {
            var path=Path.Combine(folder,file);b.Export(new FileInfo(path),ExportOptions.WithDefaults);return path;
        }
        private void DeleteCheckTargets(PlcSoftware plc,List<PlcBlock> blocks,DeletePlan plan,string archive,string suffix,bool compare)
        {
            var control=DeleteFind(blocks,plan.Control);
            BlockDeletePolicy.Candidate(DeleteIdentity(plc,control),0);
            var controlReferences=DeleteReferences(control);
            BlockDeletePolicy.Control(DeleteIdentity(plc,control),controlReferences,plan.Caller);
            var evidence=new Dictionary<string,List<DeleteReferenceSource>> {{plan.Control,controlReferences}};
            for(int i=0;i<plan.Targets.Count;i++)
            {
                var expected=plan.Targets[i];var b=DeleteFind(blocks,expected.name);var actual=DeleteIdentity(plc,b);
                if(actual.kind!=expected.kind || actual.number!=expected.number || b.IsKnowHowProtected)
                    throw new InvalidOperationException("Wrong/protected target identity: "+expected.name);
                BlockDeletePolicy.Candidate(actual,blocks.OfType<InstanceDB>().Count(db=>db.InstanceOfName==b.Name));
                var refs=DeleteReferences(b);BlockDeletePolicy.Unused(actual,refs);evidence.Add(b.Name,refs);
                var file=DeleteExport(b,archive,i+suffix+".xml");var hash=BlockDeletePolicy.Fingerprint(File.ReadAllText(file));
                if(compare && (hash!=expected.fingerprint || actual.folder!=expected.folder || actual.language!=expected.language))
                    throw new InvalidOperationException("Target changed since preview: "+expected.name);
                actual.fingerprint=hash;
                if(!compare) plan.Targets[i]=actual;
            }
            File.WriteAllText(Path.Combine(archive,"references"+suffix+".json"),JsonConvert.SerializeObject(evidence,Formatting.Indented));
        }
        private object PreviewBlockDelete(BlockDeleteRequest request)
        {
            _deletePlan=null;
            if(request.blocks==null || request.blocks.Count<1 || request.blocks.Count>10 ||
                request.blocks.Any(b=>b==null || String.IsNullOrWhiteSpace(b.name) || (b.kind!="FB" && b.kind!="FC") || b.number<1) ||
                request.blocks.Select(b=>b.name).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=request.blocks.Count ||
                String.IsNullOrWhiteSpace(request.control_block) || String.IsNullOrWhiteSpace(request.control_caller) ||
                request.blocks.Any(b=>b.name==request.control_block))
                throw new InvalidOperationException("Supply 1–10 unique FB/FC identities and a separate known-used control block/caller.");
            var plan=new DeletePlan {Id=Guid.NewGuid().ToString("N"),Project=_project.Path.FullName,Plc=request.plc_name,
                Expires=DateTime.UtcNow.AddMinutes(10),Control=request.control_block,Caller=request.control_caller,
                RequireMemoryFit=request.require_code_memory_fit,Targets=request.blocks};
            var plc=DeletePlc();var blocks=DeleteBlocks(plc);plan.Inventory=DeleteInventory(plc,blocks);
            var archive=DeleteArchive(plan,"preview");
            DeleteCheckTargets(plc,blocks,plan,archive,"-preview",false);
            File.WriteAllText(Path.Combine(archive,"preview.json"),JsonConvert.SerializeObject(new {plan_id=plan.Id,project_path=plan.Project,plc_name=plan.Plc,blocks=plan.Targets,expires_utc=plan.Expires},Formatting.Indented));
            _deletePlan=plan;
            return new {success=true,dry_run=true,plan_id=plan.Id,expires_utc=plan.Expires,project_path=plan.Project,plc_name=plan.Plc,
                blocks=plan.Targets,archive=archive,saved=false,downloaded=false,
                warning="Deleting/reimporting an FB resets its instance DB values on download. These targets were verified to have zero instances. Apply requires confirm_delete=true and this unexpired plan_id."};
        }
        private static string DeleteArchive(DeletePlan plan,string stage)
        {
            var folder=Path.Combine(Path.GetTempPath(),"PacForge","BlockDelete",plan.Id,stage);
            if(Directory.Exists(folder)) throw new InvalidOperationException("Archive already exists.");
            Directory.CreateDirectory(folder);return folder;
        }
        private CompileResultDto DeleteCompile(PlcSoftware plc,bool requireFit)
        {
            var result=CompileAll(plc);
            if(!result.Success || result.Errors.Count!=0) throw new InvalidOperationException("Compile failed; deletion cannot be committed.");
            if(requireFit && result.Warnings.Any(w=>(w.ErrorText??"").IndexOf("required code memory",StringComparison.OrdinalIgnoreCase)>=0))
                throw new InvalidOperationException("Required code memory warning persists; candidate refused.");
            return result;
        }
        private object ApplyBlockDelete(BlockDeleteRequest request)
        {
            var plan=_deletePlan;
            if(plan==null) throw new InvalidOperationException("Preview is missing; create a fresh preview.");
            BlockDeletePolicy.ValidatePlan(request.confirm_delete,request.plan_id,plan.Id,plan.Expires,request.expected_project_path,plan.Project,request.plc_name,plan.Plc);
            _deletePlan=null; // One use, including refusal; retry starts with a fresh preview.
            var plc=DeletePlc();var blocks=DeleteBlocks(plc);
            if(DeleteInventory(plc,blocks)!=plan.Inventory) throw new InvalidOperationException("Block inventory changed since preview.");
            var archive=DeleteArchive(plan,"apply");
            // Compile first to establish an offline, consistent baseline; no deletion on failure.
            var before=DeleteCompile(plc,false);
            plc=DeletePlc();blocks=DeleteBlocks(plc);
            if(DeleteInventory(plc,blocks)!=plan.Inventory) throw new InvalidOperationException("Compile changed the user-block inventory.");
            DeleteCheckTargets(plc,blocks,plan,archive,"-backup",true);
            var parents=plan.Targets.Select(t=>(PlcBlockGroup)DeleteFind(blocks,t.name).Parent).ToList();
            // Cache survivor identities before Delete invalidates the target handles.
            var expectedInventory=DeleteInventory(plc,blocks.Where(b=>!plan.Targets.Any(t=>t.name==b.Name)).ToList());
            int expectedCount=blocks.Count-plan.Targets.Count;
            var attempted=new List<int>();
            try
            {
                for(int i=0;i<plan.Targets.Count;i++)
                {
                    var name=plan.Targets[i].name;
                    Console.WriteLine("[DELETE] "+name+": deleting/reimporting FBs resets instance values on download; verified zero instances.");
                    attempted.Add(i);DeleteFind(DeleteBlocks(plc),name).Delete();
                }
                var remaining=DeleteBlocks(plc);
                if(remaining.Count!=expectedCount || DeleteInventory(plc,remaining)!=expectedInventory)
                    throw new InvalidOperationException("Unexpected post-delete inventory.");
                var after=DeleteCompile(plc,plan.RequireMemoryFit);
                plc=DeletePlc();
                if(DeleteInventory(plc,DeleteBlocks(plc))!=expectedInventory)
                    throw new InvalidOperationException("Final compile changed the survivor inventory.");
                _project.Save();
                var receipt=new {success=true,dry_run=false,plan_id=plan.Id,project_path=plan.Project,removed=plan.Targets,
                    removed_code_bytes=plan.Targets.Sum(t=>t.work_bytes),archive=archive,before_compile=before,compile=after,saved=true,downloaded=false,plc_value_writes=0};
                File.WriteAllText(Path.Combine(archive,"receipt.json"),JsonConvert.SerializeObject(receipt,Formatting.Indented));
                return receipt;
            }
            catch(Exception original)
            {
                var recovery=BlockDeletePolicy.Recover(attempted,i=>
                {
                    if(parents[i].Blocks.Find(plan.Targets[i].name)==null)
                    {
                        Console.WriteLine("[DELETE] Restoring archived "+plan.Targets[i].name+"; zero instances were verified before deletion.");
                        parents[i].Blocks.Import(new FileInfo(Path.Combine(archive,i+"-backup.xml")),ImportOptions.Override);
                    }
                },i=>
                {
                    var b=parents[i].Blocks.Find(plan.Targets[i].name);
                    if(b==null) throw new InvalidOperationException("Restoration missing: "+plan.Targets[i].name);
                    var m=DeleteIdentity(plc,b);
                    if(m.kind!=plan.Targets[i].kind || m.number!=plan.Targets[i].number ||
                        BlockDeletePolicy.Fingerprint(File.ReadAllText(DeleteExport(b,archive,i+"-restored.xml")))!=plan.Targets[i].fingerprint)
                        throw new InvalidOperationException("Restored identity/content mismatch: "+plan.Targets[i].name);
                },()=>
                {
                    if(DeleteInventory(plc,DeleteBlocks(plc))!=plan.Inventory) throw new InvalidOperationException("Recovery inventory mismatch.");
                    DeleteCompile(plc,false);
                    plc=DeletePlc();
                    if(DeleteInventory(plc,DeleteBlocks(plc))!=plan.Inventory) throw new InvalidOperationException("Final recovery compile changed the inventory.");
                },()=>_project.Save());
                var receipt=new {success=false,plan_id=plan.Id,project_path=plan.Project,archive=archive,error=original.Message,
                    recovery_complete=recovery.complete,recovery_errors=recovery.errors,candidate_usable=false,saved=recovery.complete,downloaded=false,plc_value_writes=0};
                File.WriteAllText(Path.Combine(archive,recovery.complete?"failed-restored.json":"CANDIDATE-UNUSABLE.json"),JsonConvert.SerializeObject(receipt,Formatting.Indented));
                return receipt;
            }
        }
#endif
    }
}
