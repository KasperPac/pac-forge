using System;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using PacForgeBridge;

class BlockDeleteContractTests
{
    static void Check(bool ok,string message) {if(!ok)throw new Exception(message);}
    static void Policy(string method,params object[] args)
    {
        try {typeof(TiaPortalService).Assembly.GetType("PacForgeBridge.BlockDeletePolicy").GetMethod(method,BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args);}
        catch(TargetInvocationException e) {System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException).Throw();}
    }
    static int Main(string[] args)
    {
        try
        {
            var preview=Json.Deserialize<BlockDeleteRequest>("{\"expected_project_path\":\"C:\\\\Bench\\\\Project.ap21\",\"plc_name\":\"PLC\",\"blocks\":[{\"name\":\"Unused\",\"kind\":\"FB\",\"number\":25}]}");
            Check(preview.dry_run && !preview.confirm_delete && preview.blocks[0].number==25,"Default JSON request must be preview-only.");
            var apply=Json.Deserialize<BlockDeleteRequest>("{\"dry_run\":false,\"confirm_delete\":true,\"plan_id\":\"abc\"}");
            Check(!apply.dry_run && apply.confirm_delete && apply.plan_id=="abc","Apply JSON fields were not mapped.");
            if(args.Length==1)
            {
                var fixture=JObject.Parse(File.ReadAllText(args[0]));
                Check((bool)fixture["success"] && (bool)fixture["finished"] && !(bool)fixture["object_navigation"],"Read-only fixture must be complete.");
                var rows=(JArray)fixture["blocks"];
                foreach(var name in new[]{"LStream_XmlDeserializer","LStream_XmlSerializer","LStream_JsonSerializer","Pac_B_ShortTransfer"})
                {
                    var row=rows.Single(r=>(string)r["metadata"]["name"]==name);var meta=row["metadata"];
                    var identity=new DeleteBlockIdentity {name=name,kind=(string)meta["kind"],number=(int)meta["number"],folder=(string)meta["folder"],consistent=(bool)meta["is_consistent"]};
                    var roots=row["cross_references"]["sources"].ToObject<System.Collections.Generic.List<DeleteReferenceSource>>();
                    if(name.Contains("Xml"))
                    {
                        Check(!rows.Any(r=>(string)r["metadata"]["instance_of"]==name),"Unused XML FB unexpectedly has instances.");
                        Policy("Unused",identity,roots);
                    }
                    else
                    {
                        Policy("Control",identity,roots,name=="LStream_JsonSerializer"?"JsonSerializeDeserialize":"ELEVATOR_MGMT");
                        bool refused=false;try {Policy("Unused",identity,roots);}catch(InvalidOperationException){refused=true;}
                        Check(refused,"Native used block was accepted as unused.");
                    }
                }
                Console.WriteLine("4 measured native reference fixtures passed.");
            }
            Console.WriteLine("2 Bridge JSON contract checks passed.");return 0;
        }
        catch(Exception e) {Console.Error.WriteLine(e.ToString());return 1;}
    }
}
