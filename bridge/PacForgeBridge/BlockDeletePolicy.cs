using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace PacForgeBridge
{
    public sealed class BlockDeleteRecovery { public bool complete; public List<string> errors=new List<string>(); }
    public sealed class DeleteBlockIdentity
    {
        public string name, kind, folder, language, fingerprint;
        public int number;
        public long work_bytes;
        public bool consistent;
    }
    public sealed class DeleteReferenceLocation { public string relation, access; }
    public sealed class DeleteReference { public string name; public List<DeleteReferenceLocation> locations; }
    public sealed class DeleteReferenceSource
    {
        public string name, address, path, type;
        public List<DeleteReferenceSource> children;
        public List<DeleteReference> references;
    }
    internal static class BlockDeletePolicy
    {
        internal static BlockDeleteRecovery Recover<T>(IEnumerable<T> attempted,Action<T> restore,Action<T> verify,Action compile,Action save)
        {
            var report=new BlockDeleteRecovery();var all=attempted.ToList();
            report.errors.AddRange(RestoreAll(all,restore));
            report.errors.AddRange(RestoreAll(all,verify));
            if(report.errors.Count==0) try {compile();} catch(Exception e) {report.errors.Add("Compile: "+e.Message);}
            if(report.errors.Count==0) try {save();report.complete=true;} catch(Exception e) {report.errors.Add("Save: "+e.Message);}
            return report;
        }
        internal static void ValidatePlan(bool confirm,string requested,string actual,DateTime expires,string requestedProject,string actualProject,string requestedPlc,string actualPlc)
        {
            if(!confirm || String.IsNullOrWhiteSpace(actual) || requested!=actual || DateTime.UtcNow>expires ||
                !String.Equals(requestedProject,actualProject,StringComparison.OrdinalIgnoreCase) || requestedPlc!=actualPlc)
                throw new InvalidOperationException("An explicit confirmation and matching, unexpired preview are required.");
        }
        internal static void Candidate(DeleteBlockIdentity m,int instances)
        {
            if(m==null || !m.consistent || (m.kind!="FB" && m.kind!="FC") ||
                String.IsNullOrWhiteSpace(m.language) || m.language.StartsWith("F_",StringComparison.OrdinalIgnoreCase) ||
                m.language=="FCP" || instances!=0)
                throw new InvalidOperationException("Only consistent standard FB/FC blocks with zero instances may be deleted.");
        }
        private static IEnumerable<DeleteReferenceSource> Walk(IEnumerable<DeleteReferenceSource> sources)
        {
            if(sources==null) throw new InvalidOperationException("Missing reference sources.");
            foreach(var s in sources)
            {
                if(s==null || s.children==null || s.references==null) throw new InvalidOperationException("Incomplete native source.");
                foreach(var r in s.references)
                    if(r==null || r.locations==null || r.locations.Count==0 || r.locations.Any(l=>l==null || String.IsNullOrWhiteSpace(l.relation) || String.IsNullOrWhiteSpace(l.access)))
                        throw new InvalidOperationException("Incomplete native reference locations.");
                yield return s;
                foreach(var child in Walk(s.children)) yield return child;
            }
        }
        private static List<DeleteReference> References(DeleteBlockIdentity m,IEnumerable<DeleteReferenceSource> sources)
        {
            var roots=sources==null?null:sources.ToList();
            if(m==null || !m.consistent || roots==null || roots.Count!=1 || roots[0]==null ||
                roots[0].name!=m.name || roots[0].address!="%"+m.kind+m.number || roots[0].path!=m.folder || String.IsNullOrWhiteSpace(roots[0].type))
                throw new InvalidOperationException("Native reference root identity mismatch.");
            return Walk(roots).SelectMany(s=>s.references).ToList();
        }
        internal static void Unused(DeleteBlockIdentity m,IEnumerable<DeleteReferenceSource> sources)
        {
            var locations=References(m,sources).SelectMany(r=>r.locations).ToList();
            if(locations.Count==0 || locations.Any(l=>l.relation!="Uses"))
                throw new InvalidOperationException("Block has incoming, unknown or empty native references.");
        }
        internal static void Control(DeleteBlockIdentity m,IEnumerable<DeleteReferenceSource> sources,string caller)
        {
            if(String.IsNullOrWhiteSpace(caller) || !References(m,sources).Where(r=>r.name==caller).SelectMany(r=>r.locations).Any(l=>l.relation=="UsedBy" && l.access=="Call"))
                throw new InvalidOperationException("Known-used native call control was not observed.");
        }
        internal static string Fingerprint(string xml)
        {
            try
            {
                // Ignore only export envelope metadata and indentation. Preserve all code/string whitespace.
                XDocument doc;
                using(var reader=XmlReader.Create(new StringReader(xml),new XmlReaderSettings {DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null}))
                    doc=XDocument.Load(reader,LoadOptions.PreserveWhitespace);
                if(doc.Root==null || doc.Root.Name.LocalName!="Document") throw new InvalidOperationException("Invalid block XML.");
                foreach(var metadata in doc.Root.Elements().Where(e=>e.Name.LocalName=="DocumentInfo").ToList()) metadata.Remove();
                foreach(var element in doc.Root.DescendantsAndSelf().Where(e=>e.HasElements && !e.Nodes().OfType<XText>().Any(t=>!String.IsNullOrWhiteSpace(t.Value))))
                    foreach(var indent in element.Nodes().OfType<XText>().ToList()) indent.Remove();
                using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(doc.ToString(SaveOptions.DisableFormatting)))).Replace("-","").ToLowerInvariant();
            }
            catch(XmlException e) {throw new InvalidOperationException("Invalid block XML.",e);}
        }
        internal static List<string> RestoreAll<T>(IEnumerable<T> blocks,Action<T> restore)
        {
            var errors=new List<string>();
            foreach(var b in blocks) try {restore(b);} catch(Exception e) {errors.Add(e.Message);}
            return errors;
        }
        internal static void RequireAuthentication(string token,bool valid)
        {
            if(String.IsNullOrWhiteSpace(token) || !valid) throw new InvalidOperationException("Block deletion requires a configured, valid bearer token.");
        }
    }
}
