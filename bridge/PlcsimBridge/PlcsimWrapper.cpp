// C++/CLI wrapper for PLCSIM Advanced V6 Runtime API.
// Bridges native C++ PLCSIM API → managed .NET for PacForgeBridge.

#include "PlcsimWrapper.h"
#include <msclr/marshal_cppstd.h>
#include <vcclr.h>

using namespace System;
using namespace System::Runtime::InteropServices;
using namespace msclr::interop;

namespace PlcsimBridge {

    // ── Helpers ─────────────────────────────────────────────────────────

    static const wchar_t* ToWChar(String^ str) {
        pin_ptr<const wchar_t> pinned = PtrToStringChars(str);
        return pinned;
    }

    // Allocate a native wchar_t buffer from a managed string (caller must free)
    static wchar_t* AllocWChar(String^ str) {
        pin_ptr<const wchar_t> pinned = PtrToStringChars(str);
        size_t len = wcslen(pinned) + 1;
        wchar_t* buf = new wchar_t[len];
        wcscpy_s(buf, len, pinned);
        return buf;
    }

    static String^ OperatingStateToString(EOperatingState state) {
        switch (state) {
        case SROS_OFF: return "Off";
        case SROS_BOOTING: return "Booting";
        case SROS_STOP: return "Stop";
        case SROS_STARTUP: return "Startup";
        case SROS_RUN: return "Run";
        case SROS_FREEZE: return "Freeze";
        case SROS_SHUTTING_DOWN: return "ShuttingDown";
        case SROS_HOLD: return "Hold";
        default: return "Unknown";
        }
    }

    static String^ ErrorCodeToString(ERuntimeErrorCode code) {
        const WCHAR* name = GetNameOfErrorCode(code);
        return name ? gcnew String(name) : String::Format("Error_{0}", (int)code);
    }

    // ── Constructor / Destructor ────────────────────────────────────────

    PlcsimRuntime::PlcsimRuntime()
        : _manager(nullptr), _instance(nullptr), _initialized(false), _lastError("") {
    }

    PlcsimRuntime::~PlcsimRuntime() {
        this->!PlcsimRuntime();
    }

    PlcsimRuntime::!PlcsimRuntime() {
        Shutdown();
    }

    void PlcsimRuntime::SetError(ERuntimeErrorCode code) {
        _lastError = ErrorCodeToString(code);
    }

    void PlcsimRuntime::SetError(String^ message) {
        _lastError = message;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    bool PlcsimRuntime::Initialize() {
        if (_initialized) return true;

        ISimulationRuntimeManager* mgr = nullptr;
        ERuntimeErrorCode result = InitializeApi(&mgr);
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }

        _manager = mgr;
        _initialized = true;
        _lastError = "";
        return true;
    }

    bool PlcsimRuntime::RegisterInstance(String^ instanceName, int cpuType) {
        if (!_initialized || _manager == nullptr) {
            SetError("API not initialized");
            return false;
        }

        IInstance* inst = nullptr;
        wchar_t* name = AllocWChar(instanceName);
        ERuntimeErrorCode result = _manager->RegisterInstance(
            (ECPUType)cpuType,
            name,
            &inst
        );
        delete[] name;

        if (result != SREC_OK && result != SREC_WARNING_ALREADY_EXISTS) {
            SetError(result);
            return false;
        }

        _instance = inst;
        _lastError = "";
        return true;
    }

    bool PlcsimRuntime::PowerOn(int timeoutMs) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode result = _instance->PowerOn((UINT32)timeoutMs);
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::PowerOff(int timeoutMs) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode result = _instance->PowerOff((UINT32)timeoutMs);
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::Run(int timeoutMs) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode result = _instance->Run((UINT32)timeoutMs);
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::Stop(int timeoutMs) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode result = _instance->Stop((UINT32)timeoutMs);
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }
        return true;
    }

    String^ PlcsimRuntime::GetOperatingState() {
        if (_instance == nullptr) return "NoInstance";
        return OperatingStateToString(_instance->GetOperatingState());
    }

    bool PlcsimRuntime::UpdateTagList() {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode result = _instance->UpdateTagList();
        if (result != SREC_OK) {
            SetError(result);
            return false;
        }
        return true;
    }

    // ── Tag Read ────────────────────────────────────────────────────────

    TagReadResult^ PlcsimRuntime::ReadBool(String^ tagName) {
        auto result = gcnew TagReadResult();
        result->TagName = tagName;
        result->DataType = "Bool";

        if (_instance == nullptr) {
            result->Success = false;
            result->ErrorMessage = "No instance registered";
            return result;
        }

        bool value = false;
        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->ReadBool(tag, &value);
        delete[] tag;

        if (rc != SREC_OK) {
            result->Success = false;
            result->ErrorMessage = ErrorCodeToString(rc);
            return result;
        }

        result->Success = true;
        result->Value = value;
        return result;
    }

    TagReadResult^ PlcsimRuntime::ReadInt16(String^ tagName) {
        auto result = gcnew TagReadResult();
        result->TagName = tagName;
        result->DataType = "Int16";

        if (_instance == nullptr) {
            result->Success = false;
            result->ErrorMessage = "No instance registered";
            return result;
        }

        INT16 value = 0;
        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->ReadInt16(tag, &value);
        delete[] tag;

        if (rc != SREC_OK) {
            result->Success = false;
            result->ErrorMessage = ErrorCodeToString(rc);
            return result;
        }

        result->Success = true;
        result->Value = (short)value;
        return result;
    }

    TagReadResult^ PlcsimRuntime::ReadInt32(String^ tagName) {
        auto result = gcnew TagReadResult();
        result->TagName = tagName;
        result->DataType = "Int32";

        if (_instance == nullptr) {
            result->Success = false;
            result->ErrorMessage = "No instance registered";
            return result;
        }

        INT32 value = 0;
        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->ReadInt32(tag, &value);
        delete[] tag;

        if (rc != SREC_OK) {
            result->Success = false;
            result->ErrorMessage = ErrorCodeToString(rc);
            return result;
        }

        result->Success = true;
        result->Value = (int)value;
        return result;
    }

    TagReadResult^ PlcsimRuntime::ReadFloat(String^ tagName) {
        auto result = gcnew TagReadResult();
        result->TagName = tagName;
        result->DataType = "Float";

        if (_instance == nullptr) {
            result->Success = false;
            result->ErrorMessage = "No instance registered";
            return result;
        }

        // PLCSIM Advanced doesn't have a direct ReadFloat — use ReadBytes on a DB area
        // For now, use ReadInt32 and reinterpret
        result->Success = false;
        result->ErrorMessage = "Float read not yet implemented — use ReadInt32 with reinterpret";
        return result;
    }

    // ── Tag Write ───────────────────────────────────────────────────────

    bool PlcsimRuntime::WriteBool(String^ tagName, bool value) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->WriteBool(tag, value);
        delete[] tag;

        if (rc != SREC_OK) {
            SetError(rc);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::WriteInt16(String^ tagName, short value) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->WriteInt16(tag, (INT16)value);
        delete[] tag;

        if (rc != SREC_OK) {
            SetError(rc);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::WriteInt32(String^ tagName, int value) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->WriteInt32(tag, (INT32)value);
        delete[] tag;

        if (rc != SREC_OK) {
            SetError(rc);
            return false;
        }
        return true;
    }

    bool PlcsimRuntime::WriteFloat(String^ tagName, float value) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        wchar_t* tag = AllocWChar(tagName);
        ERuntimeErrorCode rc = _instance->WriteFloat(tag, value);
        delete[] tag;

        if (rc != SREC_OK) {
            SetError(rc);
            return false;
        }
        return true;
    }

    // ── Raw Area Access ─────────────────────────────────────────────────

    bool PlcsimRuntime::WriteAreaByte(int area, int offset, unsigned char value) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            return false;
        }

        ERuntimeErrorCode rc = _instance->WriteByte((EArea)area, (UINT32)offset, (BYTE)value);
        if (rc != SREC_OK) {
            SetError(rc);
            return false;
        }
        return true;
    }

    unsigned char PlcsimRuntime::ReadAreaByte(int area, int offset, bool% success) {
        if (_instance == nullptr) {
            SetError("No instance registered");
            success = false;
            return 0;
        }

        BYTE value = 0;
        ERuntimeErrorCode rc = _instance->ReadByte((EArea)area, (UINT32)offset, &value);
        if (rc != SREC_OK) {
            SetError(rc);
            success = false;
            return 0;
        }

        success = true;
        return value;
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    bool PlcsimRuntime::UnregisterInstance() {
        if (_instance == nullptr) return true;

        // Try to power off first
        EOperatingState state = _instance->GetOperatingState();
        if (state == SROS_RUN || state == SROS_STOP) {
            _instance->PowerOff(5000);
        }

        ERuntimeErrorCode rc = _instance->UnregisterInstance();
        if (rc != SREC_OK) {
            SetError(rc);
            // Still null the pointer to prevent reuse
        }

        _instance = nullptr;
        return rc == SREC_OK;
    }

    void PlcsimRuntime::Shutdown() {
        if (_instance != nullptr) {
            UnregisterInstance();
        }

        if (_manager != nullptr && _initialized) {
            ShutdownAndFreeApi(_manager);
            _manager = nullptr;
            _initialized = false;
        }
    }
}
